import path from "path";
import fs from "fs";
import matter from "gray-matter";
import { CLAUDE_DIR, entityId, safeReadJson, dirExists, fileExists, readHead, readTailTs, extractText, normPath } from "./utils";
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

/** Scan agent definition .md files from plugins and user agents dir */
export function scanAgentDefinitions(): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  const seenNames = new Set<string>();

  // Plugin agents: ~/.claude/plugins/marketplaces/*/plugins/*/agents/*.md
  // Sort marketplaces so "official" comes first (wins dedup)
  const marketplacesDir = normPath(CLAUDE_DIR, "plugins/marketplaces");
  if (dirExists(marketplacesDir)) {
    try {
      const markets = fs.readdirSync(marketplacesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .sort((a, b) => {
          // Prioritize "official" marketplaces first
          const aOff = a.name.includes("official") ? 0 : 1;
          const bOff = b.name.includes("official") ? 0 : 1;
          return aOff - bOff || a.name.localeCompare(b.name);
        });

      for (const market of markets) {
        const pluginsDir = normPath(marketplacesDir, market.name, "plugins");
        if (!dirExists(pluginsDir)) continue;
        for (const plugin of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
          if (!plugin.isDirectory()) continue;
          const agentsDir = normPath(pluginsDir, plugin.name, "agents");
          if (!dirExists(agentsDir)) continue;
          for (const agentFile of fs.readdirSync(agentsDir, { withFileTypes: true })) {
            if (!agentFile.isFile() || !agentFile.name.endsWith(".md")) continue;
            const filePath = normPath(agentsDir, agentFile.name);
            const def = parseDefinition(filePath, "plugin", plugin.name, market.name);
            if (def) {
              // Deduplicate: skip agents with same name+plugin across different marketplaces
              // (e.g. "code-reviewer" from "feature-dev" in both official and code-plugins)
              // But keep agents with same name from DIFFERENT plugins in the same marketplace
              // (e.g. "code-reviewer" from "feature-dev" vs "code-reviewer" from "pr-review-toolkit")
              const dedupeKey = `${def.name}::${plugin.name}::${agentFile.name}`;
              if (seenNames.has(dedupeKey)) continue;
              seenNames.add(dedupeKey);
              defs.push(def);
            }
          }
        }
      }
    } catch (err) {
      console.warn("[agent-scanner] Failed to scan plugin agents:", (err as Error).message);
    }
  }

  // User agents: ~/.claude/agents/*.md
  const userAgentsDir = normPath(CLAUDE_DIR, "agents");
  if (dirExists(userAgentsDir)) {
    try {
      for (const f of fs.readdirSync(userAgentsDir, { withFileTypes: true })) {
        if (!f.isFile() || !f.name.endsWith(".md")) continue;
        const filePath = normPath(userAgentsDir, f.name);
        const def = parseDefinition(filePath, "user");
        if (def) defs.push(def);
      }
    } catch (err) {
      console.warn("[agent-scanner] Failed to scan user agents:", (err as Error).message);
    }
  }

  cachedDefinitions = defs;
  return defs;
}

/** Map marketplace directory names to display labels */
const MARKETPLACE_LABELS: Record<string, string> = {
  "claude-plugins-official": "Anthropic Official",
};

function marketplaceLabel(dirName: string): string {
  return MARKETPLACE_LABELS[dirName] || dirName.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Fallback frontmatter parser for files that break gray-matter (unquoted YAML values with colons) */
function parseFrontmatterFallback(raw: string): { data: Record<string, string>; content: string } {
  // Find the frontmatter block between --- markers
  const startIdx = raw.indexOf("---");
  if (startIdx < 0) return { data: {}, content: raw };
  const afterStart = raw.indexOf("\n", startIdx) + 1;
  const endIdx = raw.indexOf("\n---", afterStart);
  if (endIdx < 0) return { data: {}, content: raw };

  const fmBlock = raw.slice(afterStart, endIdx);
  const contentStart = raw.indexOf("\n", endIdx + 1);
  const content = contentStart >= 0 ? raw.slice(contentStart + 1) : "";
  const data: Record<string, string> = {};

  for (const line of fmBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) data[key] = value;
  }

  return { data, content };
}

function parseDefinition(filePath: string, source: "plugin" | "user" | "project", pluginName?: string, marketplaceDirName?: string): AgentDefinition | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");

    // Try gray-matter first, fall back to regex parser if YAML is malformed
    let fm: Record<string, any>;
    let content: string;
    try {
      const parsed = matter(raw);
      fm = parsed.data;
      content = parsed.content;
    } catch {
      const fallback = parseFrontmatterFallback(raw);
      fm = fallback.data;
      content = fallback.content;
    }

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
      marketplace: marketplaceDirName ? marketplaceLabel(marketplaceDirName) : undefined,
      filePath: filePath.replace(/\\/g, "/"),
      content: content.trim().slice(0, 3000),
      writable: source !== "plugin",
    };
  } catch {
    return null;
  }
}

/** Scan all agent execution JSONL files */
export function scanAgentExecutions(): { executions: AgentExecution[]; stats: AgentStats } {
  const projectsDir = normPath(CLAUDE_DIR, "projects");
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
      const projectDir = normPath(projectsDir, dir.name);

      // Look for subagents directory inside session directories
      try {
        const sessionDirs = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const sessionDir of sessionDirs) {
          // subagents can be directly in the project dir
          if (sessionDir.isDirectory() && sessionDir.name === "subagents") {
            scanSubagentsDir(normPath(projectDir, "subagents"), dir.name, executions, sessionSet, byType, byModel);
          }
          // Or inside session subdirectories
          if (sessionDir.isDirectory() && sessionDir.name !== "subagents" && sessionDir.name !== "memory") {
            const subagentsPath = normPath(projectDir, sessionDir.name, "subagents");
            if (dirExists(subagentsPath)) {
              scanSubagentsDir(subagentsPath, dir.name, executions, sessionSet, byType, byModel);
            }
          }
        }
      } catch (err) {
        console.warn(`[agent-scanner] Failed to scan project ${dir.name}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn("[agent-scanner] Failed to read projects dir:", (err as Error).message);
  }

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
      const filePath = normPath(subagentsPath, f.name);
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
  } catch (err) {
    console.warn(`[agent-scanner] Failed to scan subagents at ${subagentsPath}:`, (err as Error).message);
  }
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
