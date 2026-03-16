import { Router, type Request, type Response } from "express";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { getCachedSessions, getCachedStats, removeCachedSession, restoreCachedSession } from "../scanner/session-scanner";
import { decodeProjectKey, readMessageTimeline } from "../scanner/utils";
import { SessionIdSchema, SessionListSchema, IdsArraySchema, validate, qstr } from "./validation";
import { TRASH_DIR, MAX_SESSIONS_RESPONSE } from "../config";

const router = Router();

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
    const lowerQ = q.toLowerCase();
    sessions = sessions.filter(s => {
      const haystack = [s.firstMessage, s.slug, s.tags.join(" "), s.id].join(" ").toLowerCase();
      return haystack.includes(lowerQ);
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

  res.json({
    sessions: paged,
    stats,
    canUndo: lastDeleteBatch.length > 0,
    pagination: { page, limit, total, totalPages },
  });
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
      deleted.push(id);
    } else {
      failed.push(id);
    }
  }

  lastDeleteBatch = batch;
  res.json({ deleted, failed, canUndo: batch.length > 0 });
});

/** POST /api/sessions/delete-all — Delete all sessions (moves to trash) */
router.post("/api/sessions/delete-all", (_req: Request, res: Response) => {
  const sessions = [...getCachedSessions()];
  if (sessions.length === 0) return res.json({ deleted: 0, canUndo: false });

  const batch: DeleteRecord[] = [];
  let deleted = 0;

  for (const session of sessions) {
    const trashPath = trashSession(session.filePath);
    if (trashPath) {
      batch.push({ id: session.id, trashPath, originalPath: session.filePath, sessionSnapshot: { ...session }, timestamp: Date.now() });
      removeCachedSession(session.id);
      deleted++;
    }
  }

  lastDeleteBatch = batch;
  res.json({ deleted, canUndo: batch.length > 0 });
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

  const plat = os.platform();
  const env = { ...process.env, CLAUDECODE: undefined };

  let child;
  if (plat === "win32") {
    child = spawn("cmd", ["/k", "claude", "--resume", session.id], {
      detached: true,
      stdio: "ignore",
      env,
    });
  } else if (plat === "darwin") {
    child = spawn("osascript", ["-e", `tell application "Terminal" to do script "claude --resume ${session.id}"`], {
      detached: true,
      stdio: "ignore",
      env,
    });
  } else {
    child = spawn("x-terminal-emulator", ["-e", "claude", "--resume", session.id], {
      detached: true,
      stdio: "ignore",
      env,
    });
  }
  child.unref();
  res.json({ message: "Opening session", id: session.id });
});

export default router;
