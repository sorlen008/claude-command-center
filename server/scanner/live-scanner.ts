import path from "path";
import fs from "fs";
import { CLAUDE_DIR, dirExists, safeReadJson, readHead, normPath } from "./utils";
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

import { getPricing as getModelPricingShared, getMaxTokens, getUsableContext, computeCost } from "./pricing";

/** Find the session JSONL file across all project dirs by exact session-id match.
 *  `projDirNames` is listed once per getLiveData() call and passed in, so this
 *  doesn't re-read the projects directory per session (N+1).
 *  NOTE: a most-recently-modified "stale fallback" was deliberately REMOVED in
 *  v1.21.0 (commit ec948e1) because it matched the wrong session after context
 *  compaction. Do not reinstate it — return null on no exact match. */
function findSessionFile(sessionId: string, projectsDir: string, projDirNames: string[]): string | null {
  for (const name of projDirNames) {
    const exactPath = normPath(projectsDir, name, `${sessionId}.jsonl`);
    if (fs.existsSync(exactPath)) return exactPath;
  }
  return null;
}

/** Map a raw Claude Code permission-mode value to the badge variant.
 *  Exported for unit testing. */
export function mapPermissionMode(raw: string | undefined): ActiveSession["permissionMode"] | undefined {
  switch (raw) {
    case "bypassPermissions": return "bypass";
    case "acceptEdits": return "auto-accept";
    case "plan": return "plan";
    case "default": return "default";
    default: return undefined;
  }
}


interface SessionDetails {
  contextUsage?: ActiveSession["contextUsage"];
  lastMessage?: string;
  messageCount: number;
  sizeBytes: number;
  costEstimate: number;
  permissionMode?: ActiveSession["permissionMode"];
}

/**
 * Aggregates from a single forward pass over a session JSONL. Cost and
 * contextUsage are DERIVED from these per call (cheap arithmetic), so a
 * cache-hit still picks up cross-session 1M-context promotion; only the file
 * read is cached. Sums (tokens, messageCount) and last-wins fields (lastModel,
 * lastMessage, permRaw, lastCtxTokens) compose correctly over append-only logs,
 * which is what lets us read only the newly-appended bytes of a growing session.
 */
interface ParsedSession {
  input: number; output: number; cacheCreation: number; cacheRead: number;
  firstModel: string;   // pricing follows the first model that reported usage
  lastModel: string;    // context window follows the most recent model
  messageCount: number; // assistant records
  lastCtxTokens: number; ctxFound: boolean; maxCtxTokens: number;
  lastMessage?: string;
  permRaw?: string;
  sizeBytes: number;
}
interface ParseState extends ParsedSession { mtimeMs: number; offset: number; }

function freshParse(): ParseState {
  return {
    input: 0, output: 0, cacheCreation: 0, cacheRead: 0,
    firstModel: "", lastModel: "", messageCount: 0,
    lastCtxTokens: 0, ctxFound: false, maxCtxTokens: 0,
    lastMessage: undefined, permRaw: undefined, sizeBytes: 0, mtimeMs: 0, offset: 0,
  };
}

/** Fold one JSONL line into the running aggregates. */
function applyRecord(state: ParseState, line: string): void {
  if (!line) return;
  let r: any;
  try { r = JSON.parse(line); } catch { return; }
  if (r.type === "assistant") {
    state.messageCount++;
    const u = r.message?.usage;
    if (u) {
      const inp = u.input_tokens || 0;
      const cc = u.cache_creation_input_tokens || 0;
      const cr = u.cache_read_input_tokens || 0;
      state.input += inp;
      state.output += u.output_tokens || 0;
      state.cacheCreation += cc;
      state.cacheRead += cr;
      const ctx = inp + cc + cr;
      if (ctx > state.maxCtxTokens) state.maxCtxTokens = ctx;
      state.lastCtxTokens = ctx;
      state.ctxFound = true;
      const m = r.message?.model;
      if (m) { if (!state.firstModel) state.firstModel = m; state.lastModel = m; }
    }
  } else if (r.type === "user") {
    const content = r.message?.content;
    if (typeof content === "string") {
      if (content.length > 5) state.lastMessage = content.replace(/\n/g, " ").trim().slice(0, 4000);
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (item?.type === "text" && typeof item.text === "string" && item.text.length > 5) {
          state.lastMessage = item.text.replace(/\n/g, " ").trim().slice(0, 4000);
          break;
        }
      }
    }
  } else if (r.type === "permission-mode") {
    if (r.permissionMode) state.permRaw = r.permissionMode;
  }
}

/**
 * Parse a session JSONL into aggregates, caching the file read. Unchanged files
 * (same mtime+size) return cached aggregates with zero reads; a grown file is
 * read incrementally from the last consumed line boundary; a shrunk/rewritten
 * file (e.g. context compaction) is re-parsed from the start.
 */
const parseCache = new Map<string, ParseState>();
function parseSessionFile(filePath: string): ParsedSession {
  let st: fs.Stats;
  try { st = fs.statSync(filePath); } catch { return freshParse(); }

  const prev = parseCache.get(filePath);
  if (prev && prev.mtimeMs === st.mtimeMs && prev.sizeBytes === st.size) return prev;

  let state: ParseState;
  let startOffset: number;
  if (prev && st.size > prev.sizeBytes && prev.offset <= st.size) {
    state = prev;            // append-only growth — continue from last boundary
    startOffset = prev.offset;
  } else {
    state = freshParse();    // new, or shrunk/rewritten — full re-parse
    startOffset = 0;
  }

  if (st.size > startOffset) {
    let fd: number | null = null;
    try {
      const len = st.size - startOffset;
      const buf = Buffer.alloc(len);
      fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buf, 0, len, startOffset);
      // Process only up to the last newline so we never parse a half-written
      // line; \n is ASCII, so cutting there can't split a multibyte UTF-8 char.
      const lastNl = buf.lastIndexOf(0x0A);
      if (lastNl >= 0) {
        for (const line of buf.toString("utf-8", 0, lastNl).split("\n")) applyRecord(state, line.trim());
        state.offset = startOffset + lastNl + 1;
      }
    } catch {
      // Partial/failed read — keep whatever aggregates we have.
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch {}
    }
  }

  state.mtimeMs = st.mtimeMs;
  state.sizeBytes = st.size;
  parseCache.set(filePath, state);
  // Keep the cache from growing unbounded across many sessions.
  if (parseCache.size > 500) { const k = parseCache.keys().next().value; if (k) parseCache.delete(k); }
  return state;
}

/** Collapse a model id to its family for context-window tracking. */
function modelFamily(model: string): string {
  const m = (model || "").toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return m || "unknown";
}

/** Extract per-session context %, last human message, message count, cost, and
 *  permission mode from a session JSONL. Exported for unit testing — this is the
 *  stable contract the live-scanner perf refactor must preserve. */
export function getSessionDetails(filePath: string): SessionDetails {
  const p = parseSessionFile(filePath);

  // Build context usage with a proof-based window. A 200K-window session can
  // never exceed 200K (it auto-compacts first), so any observation >200K — in
  // this file's peak OR persisted historically for the family — proves the 1M
  // beta is in effect. Feeding that max into getMaxTokens fixes the case where a
  // 1M session currently sits below 200K and would otherwise read against 200K
  // (e.g. 198K showing 99% instead of ~20%). Derived per call (not cached with
  // the parse) so a peak proven by ANY session promotes this one's window too.
  let contextUsage: ActiveSession["contextUsage"];
  if (p.ctxFound || p.maxCtxTokens > 0) {
    const tokensUsed = p.ctxFound ? p.lastCtxTokens : p.maxCtxTokens;
    const family = modelFamily(p.lastModel);
    if (p.maxCtxTokens > 0) storage.recordObservedContext(family, p.maxCtxTokens);
    const effectiveObserved = Math.max(p.maxCtxTokens, storage.getObservedMaxContext(family));
    const maxTokens = getMaxTokens(p.lastModel, effectiveObserved);
    // Measure against the usable budget (not the raw window) so the bar matches
    // Claude Code's terminal meter, which reserves space for output + auto-compact.
    const usableTokens = getUsableContext(p.lastModel, effectiveObserved);
    const percentage = Math.min(100, Math.round((tokensUsed / usableTokens) * 100));
    contextUsage = { tokensUsed, maxTokens, usableTokens, percentage, model: p.lastModel };
  }

  // Accurate cost over the whole transcript with per-token-type rates. Pricing
  // follows the first model that reported usage (the session's primary model).
  const costEstimate = Math.round(
    computeCost(getModelPricingShared(p.firstModel), p.input, p.output, p.cacheRead, p.cacheCreation) * 100,
  ) / 100;

  return {
    contextUsage,
    lastMessage: p.lastMessage,
    messageCount: p.messageCount,
    sizeBytes: p.sizeBytes,
    costEstimate,
    permissionMode: mapPermissionMode(p.permRaw),
  };
}

/** Populate a session's history-derived fields (context %, last message, count,
 *  size, cost, status, permission mode) plus git branch and pin state. Shared by
 *  the listed-session and orphaned-agent paths so hasHistory and every derived
 *  field are set identically in both — previously hasHistory was only set on the
 *  listed-session path, leaving orphaned-agent sessions with it undefined. */
function enrichSession(
  s: ActiveSession,
  sessionFile: string | null,
  fallbackPermissionMode: ActiveSession["permissionMode"],
  pinnedSet: Set<string>,
  nowMs: number,
): void {
  s.hasHistory = !!sessionFile;
  if (sessionFile) {
    const details = getSessionDetails(sessionFile);
    s.contextUsage = details.contextUsage;
    s.lastMessage = details.lastMessage;
    s.messageCount = details.messageCount;
    s.sizeBytes = details.sizeBytes;
    s.costEstimate = details.costEstimate;
    // Permission mode — per-session from the JSONL, global as fallback.
    s.permissionMode = details.permissionMode ?? fallbackPermissionMode;
    s.status = getSessionStatus(sessionFile, nowMs);
  } else {
    s.status = "stale";
    s.permissionMode = fallbackPermissionMode;
  }
  s.gitBranch = getGitBranch(s.cwd);
  s.isPinned = pinnedSet.has(s.sessionId);
}

/** Get real-time live data — called on-demand per request, not during full scan */
export function getLiveData(): LiveData {
  const activeSessions: ActiveSession[] = [];
  const nowMs = Date.now();
  const projectsDir = normPath(CLAUDE_DIR, "projects");
  // List the project directories once per call — both the active-agent scan and
  // findSessionFile() would otherwise re-read this directory per session (N+1).
  let projDirNames: string[] = [];
  if (dirExists(projectsDir)) {
    try {
      projDirNames = fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {}
  }

  // 1. Read ~/.claude/sessions/*.json for active sessions
  const sessionsDir = normPath(CLAUDE_DIR, "sessions");
  if (dirExists(sessionsDir)) {
    try {
      const files = fs.readdirSync(sessionsDir, { withFileTypes: true });
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".json")) continue;
        const filePath = normPath(sessionsDir, f.name);
        const data = safeReadJson(filePath) as { pid?: number; sessionId?: string; cwd?: string; startedAt?: number; kind?: string; name?: string } | null;
        if (!data || !data.sessionId) continue;

        const session: ActiveSession = {
          pid: data.pid || 0,
          sessionId: data.sessionId,
          cwd: (data.cwd || "").replace(/\\/g, "/"),
          startedAt: data.startedAt || 0,
          activeAgents: [],
          // "interactive" = a real terminal; "bg" = headless background job (no window).
          kind: data.kind,
          jobName: data.kind === "bg" ? data.name : undefined,
        };

        // 2. Check for active agents in this session's subagents directory
        for (const projName of projDirNames) {
          // Check subagents directly in the project dir
          findActiveAgents(normPath(projectsDir, projName, "subagents"), session, nowMs);

          // Check subagents inside session subdirectories
          const sessionSubDir = normPath(projectsDir, projName, data.sessionId);
          if (dirExists(sessionSubDir)) {
            findActiveAgents(normPath(sessionSubDir, "subagents"), session, nowMs);
          }
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

    // 2c. Context %, last message, count, size, cost, status, permission, git, pin
    const sessionFile = findSessionFile(active.sessionId, projectsDir, projDirNames);
    enrichSession(active, sessionFile, permissionMode, pinnedSet, nowMs);
  }

  // 2g. Discover agents from sessions NOT in ~/.claude/sessions/ (orphaned/unlisted)
  //     Scan all session subdirs for recently-modified agent files
  const knownSessionIds = new Set(activeSessions.map(s => s.sessionId));
  for (const projName of projDirNames) {
    const projPath = normPath(projectsDir, projName);
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
        const sessionFile = findSessionFile(sessionId, projectsDir, projDirNames);
        enrichSession(tempSession, sessionFile, permissionMode, pinnedSet, nowMs);
        activeSessions.push(tempSession);
        knownSessionIds.add(sessionId);
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
