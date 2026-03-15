import path from "path";
import fs from "fs";
import matter from "gray-matter";
import { CLAUDE_DIR, HOME, entityId, safeReadJson, dirExists, fileExists } from "./utils";
import type { AgentDefinition, AgentExecution, AgentStats } from "@shared/types";

// Module-level cache
let cachedDefinitions: AgentDefinition[] = [];
let cachedExecutions: AgentExecution[] = [];
let cachedAgentStats: AgentStats = {
  totalExecutions: 0,
  totalDefinitions: 0,
  sessionsWithAgents: 0,
  byType: {},
  byModel: {},
};

export function getCachedDefinitions(): AgentDefinition[] { return cachedDefinitions; }
export function getCachedExecutions(): AgentExecution[] { return cachedExecutions; }
export function getCachedAgentStats(): AgentStats { return cachedAgentStats; }

/** Read first N JSON lines from file (reads only first 64KB chunk) */
function readHead(filePath: string, n: number = 5): any[] {
  try {
    const stat = fs.statSync(filePath);
    const chunkSize = Math.min(65536, stat.size);
    const buf = Buffer.alloc(chunkSize);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, 0);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n");
    const records: any[] = [];
    const limit = n * 3;
    for (let i = 0; i < Math.min(lines.length, limit); i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
        if (records.length >= n) break;
      } catch {}
    }
    return records;
  } catch {
    return [];
  }
}

/** Binary-seek last 4096 bytes to get last timestamp */
function readTailTs(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return null;
    const chunkSize = Math.min(4096, stat.size);
    const buf = Buffer.alloc(chunkSize);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, Math.max(0, stat.size - chunkSize));
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n").reverse();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const d = JSON.parse(trimmed);
        if (d.timestamp) return d.timestamp;
      } catch {}
    }
  } catch {}
  return null;
}

/** Handle string and [{type:"text", text:"..."}] content shapes */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((item: any) => item?.type === "text")
      .map((item: any) => item.text || "")
      .join(" ");
  }
  return "";
}

/** Scan agent definition .md files from plugins and user agents dir */
export function scanAgentDefinitions(): AgentDefinition[] {
  const defs: AgentDefinition[] = [];

  // Plugin agents: ~/.claude/plugins/marketplaces/*/plugins/*/agents/*.md
  const marketplacesDir = path.join(CLAUDE_DIR, "plugins/marketplaces").replace(/\\/g, "/");
  if (dirExists(marketplacesDir)) {
    try {
      for (const market of fs.readdirSync(marketplacesDir, { withFileTypes: true })) {
        if (!market.isDirectory()) continue;
        const pluginsDir = path.join(marketplacesDir, market.name, "plugins").replace(/\\/g, "/");
        if (!dirExists(pluginsDir)) continue;
        for (const plugin of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
          if (!plugin.isDirectory()) continue;
          const agentsDir = path.join(pluginsDir, plugin.name, "agents").replace(/\\/g, "/");
          if (!dirExists(agentsDir)) continue;
          for (const agentFile of fs.readdirSync(agentsDir, { withFileTypes: true })) {
            if (!agentFile.isFile() || !agentFile.name.endsWith(".md")) continue;
            const filePath = path.join(agentsDir, agentFile.name).replace(/\\/g, "/");
            const def = parseDefinition(filePath, "plugin", plugin.name);
            if (def) defs.push(def);
          }
        }
      }
    } catch {}
  }

  // User agents: ~/.claude/agents/*.md
  const userAgentsDir = path.join(CLAUDE_DIR, "agents").replace(/\\/g, "/");
  if (dirExists(userAgentsDir)) {
    try {
      for (const f of fs.readdirSync(userAgentsDir, { withFileTypes: true })) {
        if (!f.isFile() || !f.name.endsWith(".md")) continue;
        const filePath = path.join(userAgentsDir, f.name).replace(/\\/g, "/");
        const def = parseDefinition(filePath, "user");
        if (def) defs.push(def);
      }
    } catch {}
  }

  cachedDefinitions = defs;
  return defs;
}

function parseDefinition(filePath: string, source: "plugin" | "user" | "project", pluginName?: string): AgentDefinition | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    const fm = parsed.data;
    const name = fm.name || path.basename(filePath, ".md");
    const tools = typeof fm.tools === "string"
      ? fm.tools.split(",").map((t: string) => t.trim()).filter(Boolean)
      : Array.isArray(fm.tools) ? fm.tools : [];

    return {
      id: entityId(filePath),
      name,
      description: fm.description || "",
      model: fm.model || "inherit",
      color: fm.color || "",
      tools,
      source,
      pluginName,
      filePath: filePath.replace(/\\/g, "/"),
      content: parsed.content.trim().slice(0, 3000),
      writable: source !== "plugin",
    };
  } catch {
    return null;
  }
}

/** Scan all agent execution JSONL files */
export function scanAgentExecutions(): { executions: AgentExecution[]; stats: AgentStats } {
  const projectsDir = path.join(CLAUDE_DIR, "projects").replace(/\\/g, "/");
  if (!dirExists(projectsDir)) {
    cachedExecutions = [];
    cachedAgentStats = { totalExecutions: 0, totalDefinitions: cachedDefinitions.length, sessionsWithAgents: 0, byType: {}, byModel: {} };
    return { executions: [], stats: cachedAgentStats };
  }

  const executions: AgentExecution[] = [];
  const sessionSet = new Set<string>();
  const byType: Record<string, number> = {};
  const byModel: Record<string, number> = {};

  try {
    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const projectDir = path.join(projectsDir, dir.name).replace(/\\/g, "/");

      // Look for subagents directory inside session directories
      try {
        const sessionDirs = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const sessionDir of sessionDirs) {
          // subagents can be directly in the project dir
          if (sessionDir.isDirectory() && sessionDir.name === "subagents") {
            scanSubagentsDir(path.join(projectDir, "subagents").replace(/\\/g, "/"), dir.name, executions, sessionSet, byType, byModel);
          }
          // Or inside session subdirectories
          if (sessionDir.isDirectory() && sessionDir.name !== "subagents" && sessionDir.name !== "memory") {
            const subagentsPath = path.join(projectDir, sessionDir.name, "subagents").replace(/\\/g, "/");
            if (dirExists(subagentsPath)) {
              scanSubagentsDir(subagentsPath, dir.name, executions, sessionSet, byType, byModel);
            }
          }
        }
      } catch {}
    }
  } catch {}

  // Sort newest first
  executions.sort((a, b) => {
    const aTs = a.lastTs || a.firstTs || "";
    const bTs = b.lastTs || b.firstTs || "";
    return bTs.localeCompare(aTs);
  });

  const stats: AgentStats = {
    totalExecutions: executions.length,
    totalDefinitions: cachedDefinitions.length,
    sessionsWithAgents: sessionSet.size,
    byType,
    byModel,
  };

  cachedExecutions = executions;
  cachedAgentStats = stats;
  return { executions, stats };
}

function scanSubagentsDir(
  subagentsPath: string,
  projectKey: string,
  executions: AgentExecution[],
  sessionSet: Set<string>,
  byType: Record<string, number>,
  byModel: Record<string, number>,
): void {
  try {
    const files = fs.readdirSync(subagentsPath, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl") || !f.name.startsWith("agent-")) continue;
      const filePath = path.join(subagentsPath, f.name).replace(/\\/g, "/");
      const exec = parseExecution(filePath, projectKey);
      if (exec) {
        executions.push(exec);
        if (exec.sessionId) sessionSet.add(exec.sessionId);
        const typeKey = exec.agentType || "unknown";
        byType[typeKey] = (byType[typeKey] || 0) + 1;
        if (exec.model) {
          byModel[exec.model] = (byModel[exec.model] || 0) + 1;
        }
      }
    }
  } catch {}
}

function parseExecution(filePath: string, projectKey: string): AgentExecution | null {
  try {
    const stat = fs.statSync(filePath);
    const records = readHead(filePath, 5);
    const lastTs = readTailTs(filePath);

    let agentId = "";
    let slug = "";
    let sessionId = "";
    let firstTs: string | null = null;
    let model: string | null = null;
    let firstMessage = "";
    let messageCount = 0;

    for (const r of records) {
      if (!agentId && r.agentId) agentId = r.agentId;
      if (!slug && r.slug) slug = r.slug;
      if (!sessionId && r.sessionId) sessionId = r.sessionId;
      if (!firstTs && r.timestamp) firstTs = r.timestamp;

      if (r.type === "user" || r.type === "assistant") messageCount++;

      // Get model from first assistant message
      if (!model && r.type === "assistant" && r.message?.model) {
        model = r.message.model;
      }

      // Get first user message
      if (!firstMessage && r.type === "user" && r.message) {
        const content = extractText(r.message.content || "");
        if (content) firstMessage = content.replace(/\n/g, " ").trim().slice(0, 300);
      }
    }

    // Read companion .meta.json for agentType
    const metaPath = filePath.replace(".jsonl", ".meta.json");
    let agentType: string | null = null;
    if (fileExists(metaPath)) {
      const meta = safeReadJson(metaPath);
      if (meta?.agentType) agentType = meta.agentType;
    }

    if (!agentId) {
      // Extract from filename: agent-<id>.jsonl
      const match = path.basename(filePath).match(/^agent-(.+)\.jsonl$/);
      if (match) agentId = match[1];
    }

    return {
      agentId,
      slug,
      sessionId,
      projectKey,
      agentType,
      model,
      firstMessage,
      firstTs,
      lastTs,
      messageCount,
      sizeBytes: stat.size,
      filePath: filePath.replace(/\\/g, "/"),
    };
  } catch {
    return null;
  }
}
