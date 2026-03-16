import path from "path";
import fs from "fs";
import { CLAUDE_DIR, dirExists, safeReadJson, readHead, extractText } from "./utils";
import { getCachedExecutions } from "./agent-scanner";
import { getCachedSessions } from "./session-scanner";
import type { LiveData, ActiveSession } from "@shared/types";

/** Max context windows by model family */
const MODEL_MAX_TOKENS: Record<string, number> = {
  "opus": 1000000,
  "sonnet": 200000,
  "haiku": 200000,
};

function getMaxTokens(model: string): number {
  for (const [key, max] of Object.entries(MODEL_MAX_TOKENS)) {
    if (model.includes(key)) return max;
  }
  return 200000; // default
}

/** Find the session JSONL file across all project dirs */
function findSessionFile(sessionId: string, projectsDir: string): string | null {
  if (!dirExists(projectsDir)) return null;
  try {
    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const jsonlPath = path.join(projectsDir, dir.name, `${sessionId}.jsonl`).replace(/\\/g, "/");
      if (fs.existsSync(jsonlPath)) return jsonlPath;
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

/** Read context usage from the last assistant message in a session JSONL */
function getContextUsageFromFile(filePath: string): ActiveSession["contextUsage"] {
  const lines = readTailLines(filePath);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record.type === "assistant" && record.message?.usage) {
        const u = record.message.usage;
        const model = record.message.model || "";
        const tokensUsed = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        const maxTokens = getMaxTokens(model);
        return {
          tokensUsed,
          maxTokens,
          percentage: Math.round((tokensUsed / maxTokens) * 100),
          model,
        };
      }
    } catch {}
  }
  return undefined;
}

/** Read the last user message from a session JSONL */
function getLastUserMessage(filePath: string): string | undefined {
  const lines = readTailLines(filePath);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record.type === "user" && record.message) {
        const text = extractText(record.message.content || "");
        if (text) return text.replace(/\n/g, " ").trim().slice(0, 200);
      }
    } catch {}
  }
  return undefined;
}

/** Get real-time live data — called on-demand per request, not during full scan */
export function getLiveData(): LiveData {
  const activeSessions: ActiveSession[] = [];
  const nowMs = Date.now();
  const projectsDir = path.join(CLAUDE_DIR, "projects").replace(/\\/g, "/");

  // 1. Read ~/.claude/sessions/*.json for active sessions
  const sessionsDir = path.join(CLAUDE_DIR, "sessions").replace(/\\/g, "/");
  if (dirExists(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".json")) continue;
        const filePath = path.join(sessionsDir, f.name).replace(/\\/g, "/");
        const data = safeReadJson(filePath);
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
              const subagentsPath = path.join(projectsDir, projDir.name, "subagents").replace(/\\/g, "/");
              findActiveAgents(subagentsPath, session, nowMs);

              // Check subagents inside session subdirectories
              const sessionSubDir = path.join(projectsDir, projDir.name, data.sessionId).replace(/\\/g, "/");
              if (dirExists(sessionSubDir)) {
                const subPath = path.join(sessionSubDir, "subagents").replace(/\\/g, "/");
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
  for (const active of activeSessions) {
    const cached = sessionMap.get(active.sessionId);
    if (cached) {
      active.firstMessage = cached.firstMessage;
      active.slug = cached.slug;
      active.projectKey = cached.projectKey;
    }

    // 2c. Extract context usage + last user message from session JSONL
    const sessionFile = findSessionFile(active.sessionId, projectsDir);
    if (sessionFile) {
      active.contextUsage = getContextUsageFromFile(sessionFile);
      active.lastMessage = getLastUserMessage(sessionFile);
    }
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
      const filePath = path.join(subagentsPath, f.name).replace(/\\/g, "/");
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
        const meta = safeReadJson(metaPath);
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
