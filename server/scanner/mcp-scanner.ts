import type { Entity } from "@shared/types";
import { entityId, safeReadJson, getFileStat, HOME, CLAUDE_DIR, now, fileExists, discoverProjectDirs, listDirs } from "./utils";
import { MCP_CATALOG } from "./knowledge-base";
import path from "path";
import fs from "fs";

export function scanMCPs(): Entity[] {
  const results: Entity[] = [];
  const mcpFiles: string[] = [];

  // Root .mcp.json
  const rootMcp = path.join(HOME, ".mcp.json").replace(/\\/g, "/");
  if (fileExists(rootMcp)) mcpFiles.push(rootMcp);

  // Project-level .mcp.json files
  const projectsDir = path.join(CLAUDE_DIR, "projects").replace(/\\/g, "/");
  try {
    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectMcp = path.join(projectsDir, dir.name, ".mcp.json").replace(/\\/g, "/");
      if (fileExists(projectMcp)) mcpFiles.push(projectMcp);
    }
  } catch {}

  // Discovered project directories that might have .mcp.json
  for (const projDir of discoverProjectDirs()) {
    const projMcp = path.join(projDir, ".mcp.json").replace(/\\/g, "/");
    if (fileExists(projMcp) && !mcpFiles.includes(projMcp)) mcpFiles.push(projMcp);
    // One level deep
    for (const sub of listDirs(projDir)) {
      const subMcp = path.join(sub, ".mcp.json").replace(/\\/g, "/");
      if (fileExists(subMcp) && !mcpFiles.includes(subMcp)) mcpFiles.push(subMcp);
    }
  }

  // Plugin .mcp.json files
  const pluginsDir = path.join(CLAUDE_DIR, "plugins", "marketplaces").replace(/\\/g, "/");
  try {
    const marketplaceDirs = fs.readdirSync(pluginsDir, { withFileTypes: true });
    for (const mktDir of marketplaceDirs) {
      if (!mktDir.isDirectory()) continue;
      const walkPluginDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name).replace(/\\/g, "/");
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

  for (const mcpFile of mcpFiles) {
    const json = safeReadJson(mcpFile);
    if (!json) continue;
    const stat = getFileStat(mcpFile);

    // Handle both formats:
    // 1. { mcpServers: { name: { command, args } } }  — root/.mcp.json
    // 2. { name: { command, args } }                    — plugin .mcp.json (no mcpServers wrapper)
    let servers: Record<string, any>;
    if (json.mcpServers) {
      servers = json.mcpServers;
    } else if (typeof json === "object" && !Array.isArray(json)) {
      // Check if top-level keys look like server configs (have command or url)
      const hasServerShape = Object.values(json).some(
        (v: any) => typeof v === "object" && v !== null && (v.command || v.url)
      );
      if (hasServerShape) {
        servers = json;
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

    for (const [serverName, config] of Object.entries(servers as Record<string, any>)) {
      const id = entityId(`mcp:${mcpFile}:${serverName}`);
      const transport = config.url ? "sse" : "stdio";

      // Redact env values
      const redactedEnv: Record<string, string> = {};
      if (config.env) {
        for (const [k, v] of Object.entries(config.env as Record<string, string>)) {
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
