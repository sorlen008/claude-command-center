import path from "path";
import fs from "fs";
import { CLAUDE_DIR, dirExists, safeReadJson, readHead, extractText, normPath } from "./utils";
import { getCachedExecutions } from "./agent-scanner";
import { getCachedSessions } from "./session-scanner";
import { storage } from "../storage";
import type { LiveData, ActiveSession } from "@shared/types";

/** Status thresholds (ms) */
const STATUS_THINKING_MS = 10_000;    // <10s = thinking
const STATUS_WAITING_MS  = 60_000;    // 10-60s = waiting
const STATUS_IDLE_MS     = 600_000;   // 1-10min = idle
// >10min = stale

/** Determine session status based on JSONL file mtime */
function getSessionStatus(sessionFile: string, nowMs: number): ActiveSession["status"] {
  try {
    const stat = fs.statSync(sessionFile);
    const ageMs = nowMs - stat.mtime.getTime();
    if (ageMs <= STATUS_THINKING_MS) return "thinking";
    if (ageMs <= STATUS_WAITING_MS) return "waiting";
    if (ageMs <= STATUS_IDLE_MS) return "idle";
    return "stale";
  } catch {
    return "stale";
  }
}

/** Read permission mode from ~/.claude/settings.json */
function getPermissionMode(): ActiveSession["permissionMode"] {
  try {
    const settingsPath = normPath(CLAUDE_DIR, "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const allow = settings?.permissions?.allow;
    if (Array.isArray(allow)) {
      if (allow.some((p: string) => p === "*" || p === "Bash(*)")) return "bypass";
      if (allow.length > 5) return "auto-accept";
    }
    return "default";
  } catch {
    return "default";
  }
}

/** Read git branch from <cwd>/.git/HEAD without running git */
function getGitBranch(cwd: string): string | undefined {
  if (!cwd) return undefined;
  try {
    const headPath = normPath(cwd, ".git", "HEAD");
    const content = fs.readFileSync(headPath, "utf-8").trim();
    if (content.startsWith("ref: refs/heads/")) {
      return content.slice("ref: refs/heads/".length);
    }
    // Detached HEAD — return short hash
    if (/^[a-f0-9]{40}$/i.test(content)) {
      return content.slice(0, 8);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

import { getPricing as getModelPricingShared, getMaxTokens } from "./pricing";

/** Find the session JSONL file across all project dirs.
 *  Claude Code creates a new JSONL file (with a new session ID) after context
 *  compaction, but the runtime metadata in ~/.claude/sessions/<pid>.json still
 *  references the *original* session ID.  To handle this we first look for an
 *  exact match; if that file is stale (>5 min old) we fall back to the most
 *  recently modified JSONL in the same project directory — which is very likely
 *  the continuation of the same session. */
function findSessionFile(sessionId: string, projectsDir: string): string | null {
  if (!dirExists(projectsDir)) return null;
  try {
    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = normPath(projectsDir, dir.name);
      const exactPath = normPath(projectPath, `${sessionId}.jsonl`);
      if (fs.existsSync(exactPath)) return exactPath;
    }
  } catch {}
  return null;
}

/** Read the tail of a JSONL file and return lines in reverse order */
function readTailLines(filePath: string, chunkSize = 65536): string[] {
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(chunkSize, stat.size);
    const buf = Buffer.alloc(readSize);
    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch {}
    }
    return buf.toString("utf-8").split("\n").reverse();
  } catch {
    return [];
  }
}

function getModelPricing(model: string) {
  return getModelPricingShared(model);
}

interface SessionDetails {
  contextUsage?: ActiveSession["contextUsage"];
  lastMessage?: string;
  messageCount: number;
  sizeBytes: number;
  costEstimate: number;
}

/** Extract all session details in a single pass over the tail of the JSONL */
function getSessionDetails(filePath: string): SessionDetails {
  let contextUsage: ActiveSession["contextUsage"];
  let lastMessage: string | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let model = "";
  let sizeBytes = 0;

  try {
    sizeBytes = fs.statSync(filePath).size;
  } catch {}

  // Read the tail for context usage (last assistant message)
  const tailLines = readTailLines(filePath, 65536);
  for (const line of tailLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (!contextUsage && record.type === "assistant" && record.message?.usage) {
        const u = record.message.usage;
        model = record.message.model || "";
        const tokensUsed = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        const maxTokens = getMaxTokens(model);
        contextUsage = { tokensUsed, maxTokens, percentage: Math.round((tokensUsed / maxTokens) * 100), model };
      }
    } catch {}
  }

  // Read larger tail for last human message + count messages + total tokens for cost
  const bigLines = readTailLines(filePath, Math.min(sizeBytes, 1048576));
  let messageCount = 0;
  let foundLastMsg = false;

  for (const line of bigLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);

      // Count human user messages and assistant messages
      if (record.type === "assistant") {
        messageCount++;
        const u = record.message?.usage;
        if (u) {
          totalInputTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          totalOutputTokens += u.output_tokens || 0;
          if (!model && record.message?.model) model = record.message.model;
        }
      }

      // Find last human text message
      if (!foundLastMsg && record.type === "user") {
        const content = record.message?.content;
        if (typeof content === "string" && content.length > 5) {
          lastMessage = content.replace(/\n/g, " ").trim().slice(0, 200);
          foundLastMsg = true;
        } else if (Array.isArray(content)) {
          for (const item of content) {
            if (item?.type === "text" && typeof item.text === "string" && item.text.length > 5) {
              lastMessage = item.text.replace(/\n/g, " ").trim().slice(0, 200);
              foundLastMsg = true;
              break;
            }
          }
        }
      }
    } catch {}
  }

  // Estimate cost (note: we only have partial data from the tail chunk)
  // totalInputTokens here includes input + cache_create + cache_read from the tail chunk.
  // Most tokens are cache reads (90% cheaper). Use a blended rate.
  const pricing = getModelPricing(model);
  const cacheReadRate = pricing.input * 0.1;
  const blendedInputRate = totalInputTokens > 0 ? cacheReadRate : 0; // Most input is cache reads
  const costEstimate = (totalInputTokens / 1_000_000 * blendedInputRate) + (totalOutputTokens / 1_000_000 * pricing.output);

  return {
    contextUsage,
    lastMessage,
    messageCount,
    sizeBytes,
    costEstimate: Math.round(costEstimate * 1000) / 1000, // 3 decimal places
  };
}

/** Get real-time live data — called on-demand per request, not during full scan */
export function getLiveData(): LiveData {
  const activeSessions: ActiveSession[] = [];
  const nowMs = Date.now();
  const projectsDir = normPath(CLAUDE_DIR, "projects");

  // 1. Read ~/.claude/sessions/*.json for active sessions
  const sessionsDir = normPath(CLAUDE_DIR, "sessions");
  if (dirExists(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".json")) continue;
        const filePath = normPath(sessionsDir, f.name);
        const data = safeReadJson(filePath) as { pid?: number; sessionId?: string; cwd?: string; startedAt?: number } | null;
        if (!data || !data.sessionId) continue;

        const session: ActiveSession = {
          pid: data.pid || 0,
          sessionId: data.sessionId,
          cwd: (data.cwd || "").replace(/\\/g, "/"),
          startedAt: data.startedAt || 0,
          activeAgents: [],
        };

        // 2. Check for active agents in this session's subagents directory
        if (dirExists(projectsDir)) {
          try {
            const projDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
            for (const projDir of projDirs) {
              if (!projDir.isDirectory()) continue;
              // Check subagents directly in the project dir
              const subagentsPath = normPath(projectsDir, projDir.name, "subagents");
              findActiveAgents(subagentsPath, session, nowMs);

              // Check subagents inside session subdirectories
              const sessionSubDir = normPath(projectsDir, projDir.name, data.sessionId);
              if (dirExists(sessionSubDir)) {
                const subPath = normPath(sessionSubDir, "subagents");
                findActiveAgents(subPath, session, nowMs);
              }
            }
          } catch {}
        }

        activeSessions.push(session);
      }
    } catch {}
  }

  // 2b. Enrich active sessions from cached session data (zero filesystem cost)
  const cachedSessions = getCachedSessions();
  const sessionMap = new Map(cachedSessions.map(s => [s.id, s]));
  const permissionMode = getPermissionMode();
  const pinnedSet = new Set(storage.getPinnedSessions());

  for (const active of activeSessions) {
    const cached = sessionMap.get(active.sessionId);
    if (cached) {
      active.firstMessage = cached.firstMessage;
      active.slug = cached.slug;
      active.projectKey = cached.projectKey;
    }

    // 2c. Extract context usage, last message, message count, size, cost from session JSONL
    const sessionFile = findSessionFile(active.sessionId, projectsDir);
    active.hasHistory = !!sessionFile;
    if (sessionFile) {
      const details = getSessionDetails(sessionFile);
      active.contextUsage = details.contextUsage;
      active.lastMessage = details.lastMessage;
      active.messageCount = details.messageCount;
      active.sizeBytes = details.sizeBytes;
      active.costEstimate = details.costEstimate;

      // 2d. Detect session status from JSONL mtime
      active.status = getSessionStatus(sessionFile, nowMs);
    } else {
      active.status = "stale";
    }

    // 2e. Permission mode (global, same for all sessions)
    active.permissionMode = permissionMode;

    // 2f. Git branch from cwd
    active.gitBranch = getGitBranch(active.cwd);

    // 2g-a. Pin status
    active.isPinned = pinnedSet.has(active.sessionId);
  }

  // 2g. Discover agents from sessions NOT in ~/.claude/sessions/ (orphaned/unlisted)
  //     Scan all session subdirs for recently-modified agent files
  const knownSessionIds = new Set(activeSessions.map(s => s.sessionId));
  if (dirExists(projectsDir)) {
    try {
      const projDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const projDir of projDirs) {
        if (!projDir.isDirectory()) continue;
        const projPath = normPath(projectsDir, projDir.name);
        try {
          const entries = fs.readdirSync(projPath, { withFileTypes: true });
          for (const entry of entries) {
            // Session subdirs are UUID-named directories
            if (!entry.isDirectory() || !/^[0-9a-f]{8}-/.test(entry.name)) continue;
            const sessionId = entry.name;
            if (knownSessionIds.has(sessionId)) continue; // Already processed
            const subagentsPath = normPath(projPath, sessionId, "subagents");
            if (!dirExists(subagentsPath)) continue;

            // Check if any agent files are recent enough
            const tempSession: ActiveSession = {
              pid: 0,
              sessionId,
              cwd: "",
              startedAt: 0,
              activeAgents: [],
            };
            findActiveAgents(subagentsPath, tempSession, nowMs);
            if (tempSession.activeAgents.length === 0) continue;

            // Found active agents — create a session entry for them
            const cached = sessionMap.get(sessionId);
            if (cached) {
              tempSession.firstMessage = cached.firstMessage;
              tempSession.slug = cached.slug;
              tempSession.projectKey = cached.projectKey;
              tempSession.cwd = (cached.cwd || "").replace(/\\/g, "/");
            }
            const sessionFile = findSessionFile(sessionId, projectsDir);
            if (sessionFile) {
              const details = getSessionDetails(sessionFile);
              tempSession.contextUsage = details.contextUsage;
              tempSession.lastMessage = details.lastMessage;
              tempSession.messageCount = details.messageCount;
              tempSession.sizeBytes = details.sizeBytes;
              tempSession.costEstimate = details.costEstimate;
              tempSession.status = getSessionStatus(sessionFile, nowMs);
            } else {
              tempSession.status = "stale";
            }
            tempSession.permissionMode = permissionMode;
            tempSession.gitBranch = getGitBranch(tempSession.cwd);
            tempSession.isPinned = pinnedSet.has(sessionId);
            activeSessions.push(tempSession);
            knownSessionIds.add(sessionId);
          }
        } catch {}
      }
    } catch {}
  }

  // 3. Get recent activity from cached executions
  const oneHourAgo = new Date(nowMs - 3600000).toISOString();
  const recentActivity = getCachedExecutions()
    .filter(e => (e.firstTs || "") > oneHourAgo)
    .slice(0, 20);

  // 4. Count today's agents (midnight in system-local timezone)
  const nowLocal = new Date(nowMs);
  const midnightLocal = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate());
  const midnightUTC = midnightLocal.toISOString();
  const agentsToday = getCachedExecutions().filter(e => (e.firstTs || "") >= midnightUTC).length;

  // 5. Collect unique models from active agents
  const modelsSet = new Set<string>();
  for (const s of activeSessions) {
    for (const a of s.activeAgents) {
      if (a.model) modelsSet.add(a.model);
    }
  }
  const modelsInUse = Array.from(modelsSet);

  const activeAgentCount = activeSessions.reduce((sum, s) => sum + s.activeAgents.filter(a => a.status === "running").length, 0);

  return {
    activeSessions,
    recentActivity,
    stats: {
      activeSessionCount: activeSessions.length,
      activeAgentCount,
      agentsToday,
      modelsInUse,
    },
  };
}

const ACTIVE_THRESHOLD_MS = 60000;    // <60s = running
const RECENT_THRESHOLD_MS = 600000;   // <10min = recent

function findActiveAgents(subagentsPath: string, session: ActiveSession, nowMs: number): void {
  if (!dirExists(subagentsPath)) return;
  try {
    const files = fs.readdirSync(subagentsPath, { withFileTypes: true });
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl") || !f.name.startsWith("agent-")) continue;
      const filePath = normPath(subagentsPath, f.name);
      try {
        const stat = fs.statSync(filePath);
        const mtimeMs = stat.mtime.getTime();
        const ageMs = nowMs - mtimeMs;

        // Include agents modified within 10 minutes
        if (ageMs > RECENT_THRESHOLD_MS) continue;

        const records = readHead(filePath, 10);
        let agentId = "";
        let slug = "";
        let model: string | null = null;
        let agentSessionId = "";
        let task = "";

        for (const r of records) {
          if (!agentId && r.agentId) agentId = r.agentId;
          if (!slug && r.slug) slug = r.slug;
          if (!agentSessionId && r.sessionId) agentSessionId = r.sessionId;
          if (!model && r.type === "assistant" && r.message?.model) model = r.message.model;
          // Extract first user message as task description
          if (!task && r.type === "user" && r.message) {
            const content = r.message.content;
            if (typeof content === "string") {
              task = content.replace(/\n/g, " ").trim().slice(0, 150);
            } else if (Array.isArray(content)) {
              const text = content.find((c: any) => c.type === "text");
              if (text?.text) task = text.text.replace(/\n/g, " ").trim().slice(0, 150);
            }
          }
        }

        // Only add if this agent belongs to this session
        if (agentSessionId && agentSessionId !== session.sessionId) continue;

        // Read .meta.json for agentType
        const metaPath = filePath.replace(".jsonl", ".meta.json");
        let agentType: string | null = null;
        const meta = safeReadJson(metaPath) as { agentType?: string } | null;
        if (meta?.agentType) agentType = meta.agentType;

        const status = ageMs <= ACTIVE_THRESHOLD_MS ? "running" : "recent";

        session.activeAgents.push({
          agentId,
          slug,
          agentType,
          model,
          lastWriteTs: stat.mtime.toISOString(),
          task,
          status,
        });
      } catch {}
    }

    // Sort: running first, then by most recent
    session.activeAgents.sort((a, b) => {
      if (a.status !== b.status) return a.status === "running" ? -1 : 1;
      return b.lastWriteTs.localeCompare(a.lastWriteTs);
    });
  } catch {}
}
