import path from "path";
import fs from "fs";
import { CLAUDE_DIR, dirExists, safeReadJson } from "./utils";
import { getCachedExecutions } from "./agent-scanner";
import type { LiveData, ActiveSession, ActiveAgent, AgentExecution } from "@shared/types";

/** Read first N JSON lines from a file (reads only first 64KB chunk) */
function readHead(filePath: string, n: number = 3): any[] {
  try {
    const stat = fs.statSync(filePath);
    const chunkSize = Math.min(65536, stat.size);
    const buf = Buffer.alloc(chunkSize);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, 0);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n");
    const records: any[] = [];
    for (let i = 0; i < Math.min(lines.length, n * 3); i++) {
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

/** Get real-time live data — called on-demand per request, not during full scan */
export function getLiveData(): LiveData {
  const activeSessions: ActiveSession[] = [];
  const nowMs = Date.now();

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
        const projectsDir = path.join(CLAUDE_DIR, "projects").replace(/\\/g, "/");
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

  const activeAgentCount = activeSessions.reduce((sum, s) => sum + s.activeAgents.length, 0);

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
        // Agent is "active" if modified in last 60 seconds
        if (nowMs - mtimeMs > 60000) continue;

        const records = readHead(filePath, 3);
        let agentId = "";
        let slug = "";
        let model: string | null = null;
        let agentSessionId = "";

        for (const r of records) {
          if (!agentId && r.agentId) agentId = r.agentId;
          if (!slug && r.slug) slug = r.slug;
          if (!agentSessionId && r.sessionId) agentSessionId = r.sessionId;
          if (!model && r.type === "assistant" && r.message?.model) model = r.message.model;
        }

        // Only add if this agent belongs to this session
        if (agentSessionId && agentSessionId !== session.sessionId) continue;

        // Read .meta.json for agentType
        const metaPath = filePath.replace(".jsonl", ".meta.json");
        let agentType: string | null = null;
        const meta = safeReadJson(metaPath);
        if (meta?.agentType) agentType = meta.agentType;

        session.activeAgents.push({
          agentId,
          slug,
          agentType,
          model,
          lastWriteTs: stat.mtime.toISOString(),
        });
      } catch {}
    }
  } catch {}
}
