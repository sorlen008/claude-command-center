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

/** Recursively find all .md files in an agents directory */
function findAgentFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = normPath(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      } else if (entry.isDirectory()) {
        results.push(...findAgentFiles(full));
      }
    }
  } catch {}
  return results;
}

/** Scan agent definition .md files from plugins and user agents dir */
export function scanAgentDefinitions(): AgentDefinition[] {
  const allDefs: AgentDefinition[] = [];

  // Plugin agents: ~/.claude/plugins/marketplaces/*/plugins/*/agents/*.md
  // Sort marketplaces so "official" comes first (wins dedup)
  const marketplacesDir = normPath(CLAUDE_DIR, "plugins/marketplaces");
  if (dirExists(marketplacesDir)) {
    try {
      const markets = fs.readdirSync(marketplacesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .sort((a, b) => {
          const aOff = a.name.includes("official") ? 0 : 1;
          const bOff = b.name.includes("official") ? 0 : 1;
          return aOff - bOff || a.name.localeCompare(b.name);
        });

      for (const market of markets) {
        const pluginsDir = normPath(marketplacesDir, market.name, "plugins");
        if (!dirExists(pluginsDir)) continue;
        for (const plugin of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
          if (!plugin.isDirectory()) continue;
          // Recursively find agent .md files under the plugin directory
          const agentsDir = normPath(pluginsDir, plugin.name, "agents");
          const agentFiles = dirExists(agentsDir) ? findAgentFiles(agentsDir) : [];
          // Also check nested paths like skills/*/agents/
          const pluginRoot = normPath(pluginsDir, plugin.name);
          try {
            for (const sub of fs.readdirSync(pluginRoot, { withFileTypes: true })) {
              if (!sub.isDirectory() || sub.name === "agents" || sub.name === "node_modules") continue;
              const nestedAgents = normPath(pluginRoot, sub.name);
              // Recursively search for any agents/ directories
              const findNested = (dir: string) => {
                try {
                  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (e.name === "node_modules" || e.name === ".git") continue;
                    const full = normPath(dir, e.name);
                    if (e.isDirectory() && e.name === "agents") {
                      agentFiles.push(...findAgentFiles(full));
                    } else if (e.isDirectory()) {
                      findNested(full);
                    }
                  }
                } catch {}
              };
              findNested(nestedAgents);
            }
          } catch {}

          for (const filePath of agentFiles) {
            const def = parseDefinition(filePath, "plugin", plugin.name, market.name);
            if (def) allDefs.push(def);
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
        if (def) allDefs.push(def);
      }
    } catch (err) {
      console.warn("[agent-scanner] Failed to scan user agents:", (err as Error).message);
    }
  }

  // Deduplicate by agent name — keep the one with most content (description + tools)
  const byName = new Map<string, AgentDefinition>();
  for (const def of allDefs) {
    const existing = byName.get(def.name);
    if (!existing) {
      byName.set(def.name, def);
    } else {
      // Prefer agents with tools + model set over those with just long descriptions
      const score = (d: AgentDefinition) =>
        (d.description?.length || 0) + d.tools.length * 500 + (d.model && d.model !== "inherit" ? 200 : 0);
      const existingScore = score(existing);
      const newScore = score(def);
      if (newScore > existingScore) {
        byName.set(def.name, def);
      }
    }
  }

  cachedDefinitions = Array.from(byName.values());
  return cachedDefinitions;
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

    // Try gray-matter first, fall back to regex parser if YAML is malformed or fields are missing
    let fm: Record<string, any>;
    let content: string;
    try {
      const parsed = matter(raw);
      fm = parsed.data;
      content = parsed.content;
    } catch {
      fm = {};
      content = raw;
    }
    // If gray-matter returned empty/missing description, try fallback parser
    if (!fm.description || !fm.name) {
      const fallback = parseFrontmatterFallback(raw);
      if (!fm.description && fallback.data.description) fm.description = fallback.data.description;
      if (!fm.name && fallback.data.name) fm.name = fallback.data.name;
      if (!fm.model && fallback.data.model) fm.model = fallback.data.model;
      if (!fm.color && fallback.data.color) fm.color = fallback.data.color;
      if (!fm.tools && fallback.data.tools) fm.tools = fallback.data.tools;
      if (!content || content === raw) content = fallback.content;
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

// Parsed-execution cache. A finished subagent's JSONL is immutable, so once
// parsed it never needs re-reading — keyed by mtime+size to catch the rare
// in-progress agent that's still appending.
const execCache = new Map<string, { mtimeMs: number; size: number; exec: AgentExecution }>();

function parseExecution(filePath: string, projectKey: string): AgentExecution | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const hit = execCache.get(filePath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.exec;

  try {
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
      const meta = safeReadJson(metaPath) as { agentType?: string } | null;
      if (meta?.agentType) agentType = meta.agentType;
    }

    if (!agentId) {
      // Extract from filename: agent-<id>.jsonl
      const match = path.basename(filePath).match(/^agent-(.+)\.jsonl$/);
      if (match) agentId = match[1];
    }

    const exec: AgentExecution = {
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
    execCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, exec });
    // Bound the cache — agent files can be numerous across many sessions.
    if (execCache.size > 5000) { const k = execCache.keys().next().value; if (k) execCache.delete(k); }
    return exec;
  } catch {
    return null;
  }
}
