import { Router, type Request, type Response } from "express";
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { getCachedSessions, getCachedStats, removeCachedSession, restoreCachedSession } from "../scanner/session-scanner";
import { CLAUDE_DIR, decodeProjectKey, dirExists, readMessageTimeline, extractMessageText, extractToolNames } from "../scanner/utils";
import { SessionIdSchema, SessionListSchema, IdsArraySchema, DeepSearchSchema, validate, qstr } from "./validation";
import { TRASH_DIR, MAX_SESSIONS_RESPONSE } from "../config";
import { deepSearch } from "../scanner/deep-search";
import { summarizeSession, summarizeBatch } from "../scanner/session-summarizer";
import { getCostAnalytics, getFileHeatmap, getHealthAnalytics, getSessionCost, getStaleAnalytics } from "../scanner/session-analytics";
import { getSessionCommits } from "../scanner/commit-linker";
import { getProjectDashboards } from "../scanner/project-dashboard";
import { getSessionDiffs } from "../scanner/session-diffs";
import { generateWeeklyDigest } from "../scanner/weekly-digest";
import { runAutoWorkflows } from "../scanner/auto-workflows";
import { getFileTimeline } from "../scanner/file-timeline";
import { runNLQuery } from "../scanner/nl-query";
import { getContinuationBrief } from "../scanner/continuation-detector";
import { extractDecisions } from "../scanner/decision-extractor";
import { getBashKnowledgeBase, searchBashCommands } from "../scanner/bash-knowledge";
import { getNerveCenterData } from "../scanner/nerve-center";
import { delegateToTerminal, delegateToTelegram, delegateToVoice, buildContextPrompt } from "../scanner/session-delegation";
import { storage } from "../storage";
import crypto from "crypto";

const router = Router();

/** Check if claude CLI is available */
function isClaudeAvailable(): boolean {
  try {
    const env = { ...process.env };
    delete (env as Record<string, string | undefined>).CLAUDECODE;
    execSync("claude --version", { env, stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function ensureTrashDir(): void {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
}

/** Move a session file to trash instead of deleting it. Returns the trash path. */
function trashSession(filePath: string): string | null {
  ensureTrashDir();
  const basename = path.basename(filePath);
  // Add timestamp suffix to avoid collisions from concurrent deletes
  const trashPath = path.join(TRASH_DIR, `${basename}-${Date.now()}`).replace(/\\/g, "/");
  try {
    fs.copyFileSync(filePath, trashPath);
    fs.unlinkSync(filePath);
    // Also trash subdirectory if exists
    const subDir = filePath.replace(".jsonl", "");
    try {
      const stat = fs.statSync(subDir);
      if (stat.isDirectory()) {
        const trashSubDir = trashPath.replace(".jsonl", "");
        fs.cpSync(subDir, trashSubDir, { recursive: true });
        fs.rmSync(subDir, { recursive: true });
      }
    } catch {
      // No subdirectory — that's fine
    }
    return trashPath;
  } catch (err) {
    console.error("[sessions] Failed to trash session:", (err as Error).message);
    return null;
  }
}

/** Restore a session file from trash back to its original path. */
function restoreFromTrash(trashPath: string, originalPath: string): boolean {
  try {
    // Ensure the target directory exists
    const dir = path.dirname(originalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(trashPath, originalPath);
    fs.unlinkSync(trashPath);
    // Restore subdirectory if exists
    const trashSubDir = trashPath.replace(".jsonl", "");
    const origSubDir = originalPath.replace(".jsonl", "");
    try {
      const stat = fs.statSync(trashSubDir);
      if (stat.isDirectory()) {
        fs.cpSync(trashSubDir, origSubDir, { recursive: true });
        fs.rmSync(trashSubDir, { recursive: true });
      }
    } catch {
      // No subdirectory — that's fine
    }
    return true;
  } catch (err) {
    console.error("[sessions] Failed to restore session:", (err as Error).message);
    return false;
  }
}

// Track recent deletions for undo (kept in memory, cleared on server restart)
interface DeleteRecord {
  id: string;
  trashPath: string;
  originalPath: string;
  sessionSnapshot: import("@shared/types").SessionData;
  timestamp: number;
}
let lastDeleteBatch: DeleteRecord[] = [];

/** GET /api/sessions — List sessions with search/filter/sort/pagination */
router.get("/api/sessions", (req: Request, res: Response) => {
  const params = validate(SessionListSchema, {
    q: qstr(req.query.q),
    sort: qstr(req.query.sort),
    order: qstr(req.query.order),
    hideEmpty: qstr(req.query.hideEmpty),
    activeOnly: qstr(req.query.activeOnly),
    project: qstr(req.query.project),
    page: qstr(req.query.page),
    limit: qstr(req.query.limit),
  }, res);
  if (!params) return;

  const { q, sort, order, hideEmpty, activeOnly, project, page, limit } = params;

  let sessions = getCachedSessions();
  const stats = getCachedStats();

  if (project) {
    sessions = sessions.filter(s => {
      const decoded = decodeProjectKey(s.projectKey);
      return decoded.endsWith('/' + project) || decoded.endsWith('\\' + project) || s.projectKey === project;
    });
  }
  if (hideEmpty === "true") sessions = sessions.filter(s => !s.isEmpty);
  if (activeOnly === "true") sessions = sessions.filter(s => s.isActive);
  if (q) {
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    sessions = sessions.filter(s => {
      const haystack = [s.firstMessage, s.slug, s.tags.join(" "), s.id, s.summaryTopics?.join(" ")].join(" ").toLowerCase();
      return words.every(w => haystack.includes(w));
    });
  }

  const asc = order === "asc";
  sessions = [...sessions].sort((a, b) => {
    let av: string | number, bv: string | number;
    if (sort === "lastTs") { av = a.lastTs || ""; bv = b.lastTs || ""; }
    else if (sort === "firstTs") { av = a.firstTs || ""; bv = b.firstTs || ""; }
    else if (sort === "sizeBytes") { av = a.sizeBytes; bv = b.sizeBytes; }
    else if (sort === "messageCount") { av = a.messageCount; bv = b.messageCount; }
    else if (sort === "slug") { av = a.slug.toLowerCase(); bv = b.slug.toLowerCase(); }
    else { av = a.lastTs || ""; bv = b.lastTs || ""; }
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });

  const total = sessions.length;
  const totalPages = Math.ceil(total / limit);
  const cappedTotal = Math.min(total, MAX_SESSIONS_RESPONSE);
  const start = (page - 1) * limit;
  const paged = sessions.slice(start, Math.min(start + limit, cappedTotal));

  // Annotate sessions with summary, pin, and note data
  const summaries = storage.getSummaries();
  const pinnedSet = new Set(storage.getPinnedSessions());
  const notes = storage.getNotes();
  const annotated = paged.map(s => {
    const summary = summaries[s.id];
    return {
      ...s,
      hasSummary: !!summary,
      summaryTopics: summary?.topics || [],
      summaryOutcome: summary?.outcome || null,
      isPinned: pinnedSet.has(s.id),
      note: notes[s.id]?.text || undefined,
    };
  });

  res.json({
    sessions: annotated,
    stats,
    canUndo: lastDeleteBatch.length > 0,
    pagination: { page, limit, total, totalPages },
  });
});

/** GET /api/sessions/search — Deep search across all session content */
router.get("/api/sessions/search", async (req: Request, res: Response) => {
  const params = validate(DeepSearchSchema, {
    q: qstr(req.query.q),
    field: qstr(req.query.field),
    dateFrom: qstr(req.query.dateFrom),
    dateTo: qstr(req.query.dateTo),
    project: qstr(req.query.project),
    limit: qstr(req.query.limit),
  }, res);
  if (!params) return;

  try {
    const sessions = getCachedSessions();
    const summaries = storage.getSummaries();
    const result = await deepSearch({
      query: params.q,
      sessions,
      field: params.field,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      project: params.project,
      summaries,
      limit: params.limit,
    });
    res.json(result);
  } catch (err) {
    console.error("[sessions] Deep search failed:", (err as Error).message);
    res.status(500).json({ message: "Search failed" });
  }
});

/** POST /api/sessions/summarize-batch — Summarize sessions (mode: all, top10, pinned) */
const MAX_BATCH_SUMMARIZE = 10;
router.post("/api/sessions/summarize-batch", async (req: Request, res: Response) => {
  if (!isClaudeAvailable()) return res.status(503).json({ message: "Claude Code CLI not installed — required for AI summarization" });
  const modeInput = (req.body as { mode?: unknown }).mode;
  const mode = modeInput === "top10" || modeInput === "pinned" ? modeInput : "all";
  try {
    let sessions = getCachedSessions();
    const pinnedSet = new Set(storage.getPinnedSessions());

    if (mode === "pinned") {
      sessions = sessions.filter(s => pinnedSet.has(s.id));
    } else if (mode === "top10") {
      sessions = [...sessions].sort((a, b) => b.messageCount - a.messageCount).slice(0, 10);
    }

    // Cap all modes at MAX_BATCH_SUMMARIZE to prevent subprocess storms
    const result = await summarizeBatch(sessions, MAX_BATCH_SUMMARIZE);
    res.json(result);
  } catch (err) {
    console.error("[sessions] Batch summarize failed:", (err as Error).message);
    res.status(500).json({ message: "Batch summarization failed" });
  }
});

/** GET /api/sessions/analytics/costs — Cost analytics across all sessions */
router.get("/api/sessions/analytics/costs", (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(getCostAnalytics(sessions));
});

/** GET /api/sessions/analytics/files — File heatmap */
router.get("/api/sessions/analytics/files", (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(getFileHeatmap(sessions));
});

/** GET /api/sessions/analytics/health — Session health scores */
router.get("/api/sessions/analytics/health", (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(getHealthAnalytics(sessions));
});

/** GET /api/sessions/analytics/stale — Stale session suggestions */
router.get("/api/sessions/analytics/stale", (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(getStaleAnalytics(sessions));
});

/** POST /api/sessions/context-loader — Generate context prompt for a project */
router.post("/api/sessions/context-loader", (req: Request, res: Response) => {
  const project = (req.body as { project?: string })?.project;
  if (!project) return res.status(400).json({ message: "project is required" });

  const sessions = getCachedSessions();
  const summaries = storage.getSummaries();

  // Find sessions for this project, newest first, with summaries
  const projectSessions = sessions
    .filter(s => {
      const decoded = decodeProjectKey(s.projectKey);
      return decoded.endsWith("/" + project) || decoded.endsWith("\\" + project) || s.projectKey === project || s.cwd.includes(project);
    })
    .sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""));

  const relevantSessions = projectSessions.slice(0, 10);
  const parts: string[] = [];
  parts.push(`# Context from ${relevantSessions.length} recent sessions for "${project}"\n`);

  let tokensEstimate = 0;
  let used = 0;

  for (const s of relevantSessions) {
    const summary = summaries[s.id];
    if (summary) {
      parts.push(`## Session: ${s.firstMessage?.slice(0, 80) || s.slug}`);
      parts.push(`- Date: ${s.lastTs?.slice(0, 10) || "unknown"}`);
      parts.push(`- Outcome: ${summary.outcome}`);
      parts.push(`- Topics: ${summary.topics.join(", ")}`);
      parts.push(`- Summary: ${summary.summary}`);
      if (summary.filesModified.length > 0) {
        parts.push(`- Files: ${summary.filesModified.join(", ")}`);
      }
      parts.push("");
      used++;
    } else {
      parts.push(`## Session: ${s.firstMessage?.slice(0, 80) || s.slug}`);
      parts.push(`- Date: ${s.lastTs?.slice(0, 10) || "unknown"} | ${s.messageCount} messages`);
      parts.push("");
      used++;
    }
  }

  const prompt = parts.join("\n");
  tokensEstimate = Math.round(prompt.length / 4);

  res.json({ prompt, sessionsUsed: used, tokensEstimate });
});

/** GET /api/sessions/analytics/projects — Project dashboards */
router.get("/api/sessions/analytics/projects", (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(getProjectDashboards(sessions));
});

/** GET /api/sessions/analytics/digest — Weekly digest */
router.get("/api/sessions/analytics/digest", (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(generateWeeklyDigest(sessions));
});

/** GET /api/sessions/prompts — List prompt templates */
router.get("/api/sessions/prompts", (_req: Request, res: Response) => {
  res.json(storage.getPromptTemplates());
});

/** POST /api/sessions/prompts — Create prompt template */
router.post("/api/sessions/prompts", (req: Request, res: Response) => {
  const body = req.body as { name?: string; description?: string; prompt?: string; project?: string; tags?: string[] };
  if (!body.name || !body.prompt) return res.status(400).json({ message: "name and prompt are required" });

  const template = {
    id: crypto.randomUUID(),
    name: body.name.slice(0, 200),
    description: (body.description || "").slice(0, 500),
    prompt: body.prompt.slice(0, 5000),
    project: body.project?.slice(0, 200),
    tags: (body.tags || []).slice(0, 10).map(t => String(t).slice(0, 50)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };

  storage.upsertPromptTemplate(template);
  res.json(template);
});

/** PATCH /api/sessions/prompts/:id — Update prompt template */
router.patch("/api/sessions/prompts/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const existing = storage.getPromptTemplate(id);
  if (!existing) return res.status(404).json({ message: "Template not found" });

  const body = req.body as Partial<{ name: string; description: string; prompt: string; tags: string[]; isFavorite: boolean }>;
  const updated = {
    ...existing,
    ...(body.name !== undefined && { name: body.name.slice(0, 200) }),
    ...(body.description !== undefined && { description: body.description.slice(0, 500) }),
    ...(body.prompt !== undefined && { prompt: body.prompt.slice(0, 5000) }),
    ...(body.tags !== undefined && { tags: body.tags.slice(0, 10).map(t => String(t).slice(0, 50)) }),
    ...(body.isFavorite !== undefined && { isFavorite: body.isFavorite }),
    updatedAt: new Date().toISOString(),
  };

  storage.upsertPromptTemplate(updated);
  res.json(updated);
});

/** DELETE /api/sessions/prompts/:id — Delete prompt template */
router.delete("/api/sessions/prompts/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!storage.getPromptTemplate(id)) return res.status(404).json({ message: "Template not found" });
  storage.deletePromptTemplate(id);
  res.json({ message: "Deleted" });
});

/** GET /api/sessions/workflows — Get workflow config */
router.get("/api/sessions/workflows", (_req: Request, res: Response) => {
  res.json(storage.getWorkflowConfig());
});

/** PATCH /api/sessions/workflows — Update workflow config */
router.patch("/api/sessions/workflows", (req: Request, res: Response) => {
  const body = req.body as Partial<import("@shared/types").WorkflowConfig>;
  const updated = storage.updateWorkflowConfig(body);
  res.json(updated);
});

/** POST /api/sessions/workflows/run — Run auto-workflows manually */
router.post("/api/sessions/workflows/run", async (_req: Request, res: Response) => {
  try {
    const sessions = getCachedSessions();
    const result = await runAutoWorkflows(sessions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

/** POST /api/sessions/pin/:id — Toggle pin */
router.post("/api/sessions/pin/:id", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(String(req.params.id));
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });
  const isPinned = storage.togglePin(idResult.data);
  res.json({ sessionId: idResult.data, isPinned });
});

/** GET /api/sessions/file-timeline — Timeline of changes to a file across sessions */
router.get("/api/sessions/file-timeline", (req: Request, res: Response) => {
  const filePath = qstr(req.query.path);
  if (!filePath) return res.status(400).json({ message: "path parameter is required" });
  const sessions = getCachedSessions();
  res.json(getFileTimeline(sessions, filePath));
});

/** POST /api/sessions/nl-query — Natural language query */
router.post("/api/sessions/nl-query", async (req: Request, res: Response) => {
  if (!isClaudeAvailable()) return res.status(503).json({ message: "Claude Code CLI not installed — required for natural language queries" });
  const question = (req.body as { question?: string })?.question;
  if (!question || question.length < 3) return res.status(400).json({ message: "question is required (min 3 chars)" });
  try {
    const sessions = getCachedSessions();
    const result = await runNLQuery(question.slice(0, 500), sessions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

/** GET /api/sessions/continuations — Unfinished work that needs attention */
router.get("/api/sessions/continuations", async (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(await getContinuationBrief(sessions));
});

/** GET /api/sessions/decisions — List all decisions */
router.get("/api/sessions/decisions", (req: Request, res: Response) => {
  const q = qstr(req.query.q);
  if (q) {
    res.json(storage.searchDecisions(q));
  } else {
    res.json(storage.getDecisions());
  }
});

/** POST /api/sessions/decisions/extract/:id — Extract decisions from a session */
router.post("/api/sessions/decisions/extract/:id", async (req: Request, res: Response) => {
  if (!isClaudeAvailable()) return res.status(503).json({ message: "Claude Code CLI not installed — required for decision extraction" });
  const idResult = SessionIdSchema.safeParse(String(req.params.id));
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });
  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });
  try {
    const decisions = await extractDecisions(session);
    res.json({ decisions, count: decisions.length });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

/** GET /api/sessions/analytics/bash — Bash command knowledge base */
router.get("/api/sessions/analytics/bash", (_req: Request, res: Response) => {
  const sessions = getCachedSessions();
  res.json(getBashKnowledgeBase(sessions));
});

/** GET /api/sessions/analytics/bash/search — Search bash commands */
router.get("/api/sessions/analytics/bash/search", (req: Request, res: Response) => {
  const q = qstr(req.query.q);
  if (!q) return res.status(400).json({ message: "q parameter required" });
  const sessions = getCachedSessions();
  res.json(searchBashCommands(sessions, q));
});

/** GET /api/sessions/nerve-center — Operations nerve center */
router.get("/api/sessions/nerve-center", async (_req: Request, res: Response) => {
  try {
    const sessions = getCachedSessions();
    res.json(await getNerveCenterData(sessions));
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

/** POST /api/sessions/delegate — Delegate session to terminal/telegram/voice */
router.post("/api/sessions/delegate", async (req: Request, res: Response) => {
  const body = req.body as { sessionId?: string; target?: string; task?: string };
  if (!body.sessionId || !body.target) return res.status(400).json({ message: "sessionId and target required" });
  const idResult = SessionIdSchema.safeParse(body.sessionId);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID" });
  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const task = (body.task || "").slice(0, 500);

  if (body.target === "terminal") {
    res.json(delegateToTerminal(session));
  } else if (body.target === "telegram") {
    res.json(await delegateToTelegram(session, task));
  } else if (body.target === "voice") {
    res.json(delegateToVoice(session, task));
  } else {
    res.status(400).json({ message: "target must be terminal, telegram, or voice" });
  }
});

/** GET /api/sessions/:id/context — Build context prompt for delegation */
router.get("/api/sessions/:id/context", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });
  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });
  res.json({ prompt: buildContextPrompt(session) });
});

/** GET /api/sessions/:id — Session detail with message timeline */
router.get("/api/sessions/:id", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const records = readMessageTimeline(session.filePath);

  res.json({ ...session, records });
});

/** Find the JSONL file for a session across all project dirs */
function findSessionJsonl(sessionId: string): string | null {
  const projectsDir = path.join(CLAUDE_DIR, "projects").replace(/\\/g, "/");
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

interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
  tokenCount?: number;
  hasToolUse?: boolean;
  toolNames?: string[];
}

// extractMessageText and extractToolNames imported from ../scanner/utils

/** Parse an entire session JSONL file into conversation messages */
function parseSessionMessages(filePath: string, offset: number, limit: number): { messages: SessionMessage[]; totalMessages: number } {
  const allMessages: SessionMessage[] = [];
  const MAX_MESSAGES = 2000; // Safety cap to prevent OOM

  try {
    // Read entire file then iterate lines (large files capped at MAX_MESSAGES)
    const content = fs.readFileSync(filePath, "utf-8");
    let pos = 0;

    while (pos < content.length && allMessages.length < MAX_MESSAGES) {
      const nextNewline = content.indexOf("\n", pos);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const trimmed = content.slice(pos, lineEnd).trim();
      pos = lineEnd + 1;

      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);

        if (record.type === "user") {
          const msg = record.message;
          if (!msg || typeof msg !== "object") continue;
          const text = extractMessageText(msg.content, true);
          if (!text) continue;
          allMessages.push({
            role: "user",
            content: text.slice(0, 500),
            timestamp: record.timestamp || "",
          });
        } else if (record.type === "assistant") {
          const msg = record.message;
          if (!msg || typeof msg !== "object") continue;
          const text = extractMessageText(msg.content, false);
          const toolNames = extractToolNames(msg.content);

          const message: SessionMessage = {
            role: "assistant",
            content: text.slice(0, 500),
            timestamp: record.timestamp || "",
          };

          if (msg.model) message.model = msg.model;
          if (msg.usage?.input_tokens) message.tokenCount = msg.usage.input_tokens;
          if (toolNames.length > 0) {
            message.hasToolUse = true;
            message.toolNames = toolNames;
          }

          allMessages.push(message);
        }
      } catch {
        // Malformed JSON line — skip
      }
    }
  } catch {
    // File unreadable
  }

  const totalMessages = allMessages.length;
  const sliced = allMessages.slice(offset, offset + limit);
  return { messages: sliced, totalMessages };
}

/** GET /api/sessions/:id/messages — Conversation message history */
router.get("/api/sessions/:id/messages", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const sessionId = idResult.data;

  // Find the JSONL file
  const jsonlPath = findSessionJsonl(sessionId);
  if (!jsonlPath) return res.status(404).json({ message: "Session file not found" });

  // Pagination
  const offset = Math.max(0, parseInt(qstr(req.query.offset) || "0", 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(qstr(req.query.limit) || "200", 10) || 200));

  const { messages, totalMessages } = parseSessionMessages(jsonlPath, offset, limit);

  res.json({
    sessionId,
    totalMessages,
    messages,
  });
});

/** GET /api/sessions/:id/diffs — File changes made in session */
router.get("/api/sessions/:id/diffs", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  res.json(getSessionDiffs(session));
});

/** GET /api/sessions/:id/note — Get session note */
router.get("/api/sessions/:id/note", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });
  const note = storage.getNote(idResult.data);
  if (!note) return res.status(404).json({ message: "No note" });
  res.json(note);
});

/** PUT /api/sessions/:id/note — Create/update session note */
router.put("/api/sessions/:id/note", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });
  const text = (req.body as { text?: string })?.text;
  if (typeof text !== "string") return res.status(400).json({ message: "text is required" });
  if (text.length === 0) {
    storage.deleteNote(idResult.data);
    return res.json({ message: "Note deleted" });
  }
  const note = storage.upsertNote(idResult.data, text.slice(0, 2000));
  res.json(note);
});

/** GET /api/sessions/:id/costs — Per-session cost breakdown */
router.get("/api/sessions/:id/costs", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const sessions = getCachedSessions();
  const cost = getSessionCost(sessions, idResult.data);
  if (!cost) return res.status(404).json({ message: "No cost data found" });

  res.json(cost);
});

/** GET /api/sessions/:id/commits — Git commits linked to session */
router.get("/api/sessions/:id/commits", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const commits = getSessionCommits(session);
  res.json({ sessionId: session.id, commits });
});

/** GET /api/sessions/:id/summary — Get stored summary for a session */
router.get("/api/sessions/:id/summary", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const summary = storage.getSummary(idResult.data);
  if (!summary) return res.status(404).json({ message: "No summary found for this session" });

  res.json(summary);
});

/** POST /api/sessions/:id/summarize — Generate summary for a session */
router.post("/api/sessions/:id/summarize", async (req: Request, res: Response) => {
  if (!isClaudeAvailable()) return res.status(503).json({ message: "Claude Code CLI not installed — required for AI summarization" });
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  // Return cached unless force=true
  const force = qstr(req.query.force) === "true";
  if (!force) {
    const existing = storage.getSummary(session.id);
    if (existing) return res.json(existing);
  }

  try {
    const summary = await summarizeSession(session);
    res.json(summary);
  } catch (err) {
    console.error("[sessions] Summarize failed:", (err as Error).message);
    res.status(500).json({ message: "Failed to generate summary" });
  }
});

/** DELETE /api/sessions/:id — Delete a single session (moves to trash) */
router.delete("/api/sessions/:id", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const trashPath = trashSession(session.filePath);
  if (!trashPath) return res.status(500).json({ message: "Failed to move to trash" });

  const snapshot = { ...session };
  removeCachedSession(session.id);
  storage.cleanupSessionData(session.id);
  lastDeleteBatch = [{ id: session.id, trashPath, originalPath: session.filePath, sessionSnapshot: snapshot, timestamp: Date.now() }];
  res.json({ message: "Deleted", id: session.id, canUndo: true });
});

/** DELETE /api/sessions — Bulk delete (moves to trash) */
router.delete("/api/sessions", (req: Request, res: Response) => {
  const parsed = validate(IdsArraySchema, (req.body as { ids?: string[] })?.ids, res);
  if (!parsed) return;

  const deleted: string[] = [];
  const failed: string[] = [];
  const batch: DeleteRecord[] = [];

  for (const id of parsed) {
    const session = getCachedSessions().find(s => s.id === id);
    if (!session) { failed.push(id); continue; }
    const trashPath = trashSession(session.filePath);
    if (trashPath) {
      batch.push({ id, trashPath, originalPath: session.filePath, sessionSnapshot: { ...session }, timestamp: Date.now() });
      removeCachedSession(id);
      storage.cleanupSessionData(id);
      deleted.push(id);
    } else {
      failed.push(id);
    }
  }

  lastDeleteBatch = batch;
  res.json({ deleted, failed, canUndo: batch.length > 0 });
});

/** POST /api/sessions/delete-all — Delete all sessions (moves to trash), skips pinned */
router.post("/api/sessions/delete-all", (_req: Request, res: Response) => {
  const sessions = [...getCachedSessions()];
  if (sessions.length === 0) return res.json({ deleted: 0, skipped: 0, canUndo: false });

  const pinnedSet = new Set(storage.getPinnedSessions());
  const batch: DeleteRecord[] = [];
  let deleted = 0;
  let skipped = 0;

  for (const session of sessions) {
    if (pinnedSet.has(session.id)) {
      skipped++;
      continue;
    }
    const trashPath = trashSession(session.filePath);
    if (trashPath) {
      batch.push({ id: session.id, trashPath, originalPath: session.filePath, sessionSnapshot: { ...session }, timestamp: Date.now() });
      removeCachedSession(session.id);
      storage.cleanupSessionData(session.id);
      deleted++;
    }
  }

  lastDeleteBatch = batch;
  res.json({ deleted, skipped, canUndo: batch.length > 0 });
});

/** GET /api/sessions/:id/export/html — Export session as standalone HTML */
router.get("/api/sessions/:id/export/html", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID" });

  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const records = readMessageTimeline(session.filePath, { includeModel: true });
  const summary = storage.getSummary(session.id);

  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const formatDate = (ts: string) => ts ? new Date(ts).toLocaleString() : "";

  const messagesHtml = records.map(r => {
    const isUser = r.role === "user" || r.type === "user";
    const roleLabel = isUser ? "User" : "Assistant";
    const roleColor = isUser ? "#3b82f6" : "#8b5cf6";
    const content = escapeHtml(r.contentPreview || "").replace(/\n/g, "<br>");
    return `<div style="margin:12px 0;padding:12px 16px;border-radius:8px;background:${isUser ? "#1e293b" : "#1a1a2e"};border-left:3px solid ${roleColor}">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <strong style="color:${roleColor};font-size:13px">${roleLabel}</strong>
        <span style="color:#64748b;font-size:11px">${formatDate(r.timestamp)}</span>
      </div>
      <div style="color:#e2e8f0;font-size:13px;line-height:1.6;white-space:pre-wrap">${content}</div>
    </div>`;
  }).join("\n");

  const topicsHtml = (summary?.topics || session.tags || [])
    .map((t: string) => `<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:4px;background:#334155;color:#94a3b8;font-size:11px">${escapeHtml(t)}</span>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session: ${escapeHtml(session.slug || session.firstMessage?.slice(0, 50) || session.id.slice(0, 8))}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;max-width:900px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}
.meta{color:#64748b;font-size:12px;margin-bottom:16px}
.summary{background:#1e293b;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #334155}
.summary h3{color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.summary p{color:#cbd5e1;font-size:13px;line-height:1.6}
.topics{margin:8px 0}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #1e293b;color:#475569;font-size:11px;text-align:center}
</style>
</head>
<body>
<h1>${escapeHtml(session.slug || session.firstMessage?.slice(0, 60) || "Session")}</h1>
<div class="meta">
  ${session.id} | ${session.messageCount} messages | ${formatDate(session.firstTs || "")} — ${formatDate(session.lastTs || "")}
</div>
${summary ? `<div class="summary">
  <h3>AI Summary</h3>
  <p>${escapeHtml(summary.summary)}</p>
  ${topicsHtml ? `<div class="topics">${topicsHtml}</div>` : ""}
</div>` : topicsHtml ? `<div class="topics" style="margin-bottom:16px">${topicsHtml}</div>` : ""}
<div class="messages">
${messagesHtml}
</div>
<div class="footer">
  Exported from Claude Command Center | ${new Date().toISOString().slice(0, 10)}
</div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="session-${session.id.slice(0, 8)}.html"`);
  res.send(html);
});

/** POST /api/sessions/undo — Restore last deleted batch from trash */
router.post("/api/sessions/undo", (_req: Request, res: Response) => {
  if (lastDeleteBatch.length === 0) {
    return res.status(400).json({ message: "Nothing to undo" });
  }

  let restored = 0;
  for (const record of lastDeleteBatch) {
    if (restoreFromTrash(record.trashPath, record.originalPath)) {
      restoreCachedSession(record.sessionSnapshot);
      restored++;
    }
  }

  const count = lastDeleteBatch.length;
  lastDeleteBatch = [];
  res.json({ message: `Restored ${restored} of ${count} sessions`, restored });
});

/** POST /api/sessions/:id/open — Open in CLI */
router.post("/api/sessions/:id/open", (req: Request, res: Response) => {
  const idResult = SessionIdSchema.safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ message: "Invalid session ID format" });

  const session = getCachedSessions().find(s => s.id === idResult.data);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const result = delegateToTerminal(session);
  res.json({ message: result.message, id: session.id });
});

export default router;
