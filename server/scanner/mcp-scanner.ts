import type { Entity, MCPServerConfig, MCPConfigFile, CustomNode, CustomEdge } from "@shared/types";
import { entityId, safeReadJson, getFileStat, HOME, CLAUDE_DIR, now, fileExists, discoverProjectDirs, listDirs, getExtraPaths, normPath } from "./utils";
import { MCP_CATALOG } from "./knowledge-base";
import path from "path";
import fs from "fs";

/** Database URL patterns to detect in MCP env vars */
const DB_URL_PATTERNS: { pattern: RegExp; type: string; label: string; color: string }[] = [
  { pattern: /postgresql:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, type: "database", label: "PostgreSQL", color: "#336791" },
  { pattern: /postgres:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, type: "database", label: "PostgreSQL", color: "#336791" },
  { pattern: /mysql:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, type: "database", label: "MySQL", color: "#4479A1" },
  { pattern: /mongodb(\+srv)?:\/\/([^@]+@)?([^:/]+)(:\d+)?\/(\w+)/, type: "database", label: "MongoDB", color: "#47A248" },
  { pattern: /redis:\/\/([^@]+@)?([^:/]+)(:\d+)?\/?/, type: "cache", label: "Redis", color: "#DC382D" },
  { pattern: /amqp:\/\/([^@]+@)?([^:/]+)(:\d+)?\//, type: "queue", label: "RabbitMQ", color: "#FF6600" },
];

/** Extract database/service nodes from MCP environment variables */
export function extractDbNodesFromMcps(mcpEntities: Entity[]): { nodes: CustomNode[]; edges: CustomEdge[] } {
  const nodes: CustomNode[] = [];
  const edges: CustomEdge[] = [];
  const seen = new Set<string>();

  for (const mcp of mcpEntities) {
    const env = mcp.data.env as Record<string, string> | undefined;
    if (!env) continue;

    for (const [key, value] of Object.entries(env)) {
      if (value === "***") continue; // Redacted

      for (const { pattern, type, label, color } of DB_URL_PATTERNS) {
        const match = value.match(pattern);
        if (match) {
          const host = match[type === "database" ? 2 : (type === "cache" ? 2 : 2)] || "localhost";
          const port = (match[type === "database" ? 3 : 3] || "").replace(":", "");
          const dbName = match[type === "database" ? 4 : 0] || "";

          const nodeLabel = dbName ? `${label} (${dbName})` : `${label} ${host}${port ? `:${port}` : ""}`;
          const nodeId = `db-${label.toLowerCase()}-${host}-${port || "default"}-${dbName}`.replace(/[^a-z0-9-]/g, "-");

          if (seen.has(nodeId)) {
            // Just add edge
            edges.push({
              id: `db-edge-${mcp.id}-${nodeId}`,
              source: mcp.id,
              target: nodeId,
              label: "connects_to",
              color,
              source_origin: "auto-discovered",
            });
            continue;
          }
          seen.add(nodeId);

          const description = `${host}${port ? `:${port}` : ""}${dbName ? ` / ${dbName}` : ""} (from ${key})`;

          nodes.push({
            id: nodeId,
            subType: type as "database" | "cache" | "queue",
            label: nodeLabel,
            description,
            color,
            source: "auto-discovered",
          });

          edges.push({
            id: `db-edge-${mcp.id}-${nodeId}`,
            source: mcp.id,
            target: nodeId,
            label: "connects_to",
            color,
            source_origin: "auto-discovered",
          });
        }
      }
    }
  }

  return { nodes, edges };
}

/** Type guard: check if a value looks like an MCP server config */
export function isMCPServerConfig(v: unknown): v is MCPServerConfig {
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    (typeof (v as MCPServerConfig).command === "string" || typeof (v as MCPServerConfig).url === "string");
}

export function scanMCPs(): Entity[] {
  const results: Entity[] = [];
  const mcpFiles: string[] = [];

  // Root .mcp.json
  const rootMcp = normPath(HOME, ".mcp.json");
  if (fileExists(rootMcp)) mcpFiles.push(rootMcp);

  // Project-level .mcp.json files
  const projectsDir = normPath(CLAUDE_DIR, "projects");
  try {
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectMcp = normPath(projectsDir, dir.name, ".mcp.json");
      if (fileExists(projectMcp)) mcpFiles.push(projectMcp);
    }
  } catch {}

  // Discovered project directories that might have .mcp.json
  for (const projDir of discoverProjectDirs()) {
    const projMcp = normPath(projDir, ".mcp.json");
    if (fileExists(projMcp) && !mcpFiles.includes(projMcp)) mcpFiles.push(projMcp);
    // One level deep
    for (const sub of listDirs(projDir)) {
      const subMcp = normPath(sub, ".mcp.json");
      if (fileExists(subMcp) && !mcpFiles.includes(subMcp)) mcpFiles.push(subMcp);
    }
  }

  // Plugin .mcp.json files
  const pluginsDir = normPath(CLAUDE_DIR, "plugins", "marketplaces");
  try {
    const marketplaceDirs = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const mktDir of marketplaceDirs) {
      if (!mktDir.isDirectory()) continue;
      const walkPluginDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = normPath(dir, entry.name);
            if (entry.isFile() && entry.name === ".mcp.json") {
              if (!mcpFiles.includes(fullPath)) mcpFiles.push(fullPath);
            } else if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
              walkPluginDir(fullPath);
            }
          }
        } catch {}
      };
      walkPluginDir(path.join(pluginsDir, mktDir.name));
    }
  } catch {}

  // Extra MCP files from settings
  for (const extra of getExtraPaths().extraMcpFiles) {
    const normalized = extra.replace(/\\/g, "/");
    if (fileExists(normalized) && !mcpFiles.includes(normalized)) mcpFiles.push(normalized);
  }

  for (const mcpFile of mcpFiles) {
    const json = safeReadJson(mcpFile) as MCPConfigFile | null;
    if (!json) continue;
    const stat = getFileStat(mcpFile);

    // Handle both formats:
    // 1. { mcpServers: { name: { command, args } } }  — root/.mcp.json
    // 2. { name: { command, args } }                    — plugin .mcp.json (no mcpServers wrapper)
    let servers: Record<string, MCPServerConfig>;
    if (json.mcpServers) {
      servers = json.mcpServers;
    } else if (typeof json === "object" && !Array.isArray(json)) {
      // Check if top-level keys look like server configs (have command or url)
      const hasServerShape = Object.values(json).some(isMCPServerConfig);
      if (hasServerShape) {
        // Filter to only entries that look like server configs
        servers = {} as Record<string, MCPServerConfig>;
        for (const [k, v] of Object.entries(json)) {
          if (isMCPServerConfig(v)) {
            servers[k] = v;
          }
        }
      } else {
        continue;
      }
    } else {
      continue;
    }

    // Determine source context for description
    const isPlugin = mcpFile.includes("/plugins/");
    const pluginName = isPlugin
      ? mcpFile.split("/external_plugins/")[1]?.split("/")[0] || mcpFile.split("/plugins/")[1]?.split("/")[0] || ""
      : "";

    for (const [serverName, config] of Object.entries(servers)) {
      const id = entityId(`mcp:${mcpFile}:${serverName}`);
      const transport = config.url ? "sse" : "stdio";

      // Redact env values
      const redactedEnv: Record<string, string> = {};
      if (config.env) {
        for (const [k, v] of Object.entries(config.env)) {
          redactedEnv[k] = k.toLowerCase().includes("secret") || k.toLowerCase().includes("password") || k.toLowerCase().includes("token") || k.toLowerCase().includes("key")
            ? "***"
            : v;
        }
      }

      const catalog = MCP_CATALOG[serverName];
      const description = catalog
        ? catalog.description
        : isPlugin
          ? `${transport} MCP server (plugin: ${pluginName})`
          : `${transport} MCP server from ${path.basename(mcpFile)}`;
      const tags = isPlugin ? [transport, "plugin"] : [transport];
      if (catalog) tags.push(catalog.category);

      results.push({
        id,
        type: "mcp",
        name: serverName,
        path: mcpFile,
        description,
        lastModified: stat?.mtime ?? null,
        tags,
        health: "ok",
        data: {
          transport,
          command: config.command ?? undefined,
          args: config.args ?? undefined,
          url: config.url ?? undefined,
          sourceFile: mcpFile,
          env: Object.keys(redactedEnv).length > 0 ? redactedEnv : undefined,
          category: catalog?.category,
          capabilities: catalog?.capabilities,
          website: catalog?.website,
        },
        scannedAt: now(),
      });
    }
  }

  return results;
}
