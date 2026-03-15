import { Router, type Request, type Response } from "express";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { getCachedSessions, getCachedStats, removeCachedSession, restoreCachedSession } from "../scanner/session-scanner";

const router = Router();

// Trash directory for undo support
const TRASH_DIR = path.join(os.tmpdir(), "claude-sessions-trash").replace(/\\/g, "/");

function ensureTrashDir(): void {
  if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
}

/** Move a session file to trash instead of deleting it. Returns the trash path. */
function trashSession(filePath: string): string | null {
  ensureTrashDir();
  const basename = path.basename(filePath);
  const trashPath = path.join(TRASH_DIR, basename).replace(/\\/g, "/");
  try {
    fs.copyFileSync(filePath, trashPath);
    fs.unlinkSync(filePath);
    // Also trash subdirectory if exists
    const subDir = filePath.replace(".jsonl", "");
    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      const trashSubDir = trashPath.replace(".jsonl", "");
      fs.cpSync(subDir, trashSubDir, { recursive: true });
      fs.rmSync(subDir, { recursive: true });
    }
    return trashPath;
  } catch {
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
    if (fs.existsSync(trashSubDir) && fs.statSync(trashSubDir).isDirectory()) {
      fs.cpSync(trashSubDir, origSubDir, { recursive: true });
      fs.rmSync(trashSubDir, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

// Track recent deletions for undo (kept in memory, cleared on server restart)
interface DeleteRecord {
  id: string;
  trashPath: string;
  originalPath: string;
  sessionSnapshot: any; // cached SessionData for restore
  timestamp: number;
}
let lastDeleteBatch: DeleteRecord[] = [];

function qstr(v: unknown): string | undefined {
  return Array.isArray(v) ? (v[0] as string) : (v as string | undefined);
}

/** GET /api/sessions — List sessions with search/filter/sort */
router.get("/api/sessions", (req: Request, res: Response) => {
  const q = qstr(req.query.q)?.toLowerCase();
  const sort = qstr(req.query.sort) || "lastTs";
  const order = qstr(req.query.order) || "desc";
  const hideEmpty = qstr(req.query.hideEmpty) === "true";
  const activeOnly = qstr(req.query.activeOnly) === "true";

  const project = qstr(req.query.project);

  let sessions = getCachedSessions();
  const stats = getCachedStats();

  if (project) {
    sessions = sessions.filter(s => {
      // Decode: C--Users-zwin0 → C:/Users/zwin0  (-- = :/, - = /)
      const decoded = s.projectKey.replace(/--/, ':/').replace(/-/g, '/');
      return decoded.endsWith('/' + project) || decoded.endsWith('\\' + project) || s.projectKey === project;
    });
  }
  if (hideEmpty) sessions = sessions.filter(s => !s.isEmpty);
  if (activeOnly) sessions = sessions.filter(s => s.isActive);
  if (q) {
    sessions = sessions.filter(s => {
      const haystack = [s.firstMessage, s.slug, s.tags.join(" "), s.id].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  const validSorts = ["lastTs", "firstTs", "sizeBytes", "messageCount", "slug"];
  const sortKey = validSorts.includes(sort) ? sort : "lastTs";
  const asc = order === "asc";

  sessions = [...sessions].sort((a, b) => {
    let av: any, bv: any;
    if (sortKey === "lastTs") { av = a.lastTs || ""; bv = b.lastTs || ""; }
    else if (sortKey === "firstTs") { av = a.firstTs || ""; bv = b.firstTs || ""; }
    else if (sortKey === "sizeBytes") { av = a.sizeBytes; bv = b.sizeBytes; }
    else if (sortKey === "messageCount") { av = a.messageCount; bv = b.messageCount; }
    else if (sortKey === "slug") { av = a.slug.toLowerCase(); bv = b.slug.toLowerCase(); }
    else { av = a.lastTs || ""; bv = b.lastTs || ""; }
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });

  res.json({ sessions, stats, canUndo: lastDeleteBatch.length > 0 });
});

/** GET /api/sessions/:id — Session detail with message timeline */
router.get("/api/sessions/:id", (req: Request, res: Response) => {
  const session = getCachedSessions().find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const records: { type: string; role?: string; timestamp: string; contentPreview: string }[] = [];
  try {
    const stat = fs.statSync(session.filePath);
    const chunkSize = Math.min(131072, stat.size);
    const buf = Buffer.alloc(chunkSize);
    const fd = fs.openSync(session.filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, 0);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n");
    let count = 0;
    for (let i = 0; i < Math.min(lines.length, 150) && count < 50; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.type === "user" || r.type === "assistant") {
          const msg = r.message;
          let preview = "";
          if (msg && typeof msg === "object") {
            const c = msg.content;
            if (typeof c === "string") preview = c;
            else if (Array.isArray(c)) {
              preview = c.filter((x: any) => x?.type === "text").map((x: any) => x.text || "").join(" ");
            }
          }
          records.push({
            type: r.type,
            role: msg?.role,
            timestamp: r.timestamp || "",
            contentPreview: preview.replace(/\n/g, " ").slice(0, 300),
          });
          count++;
        }
      } catch {}
    }
  } catch {}

  res.json({ ...session, records });
});

/** DELETE /api/sessions/:id — Delete a single session (moves to trash) */
router.delete("/api/sessions/:id", (req: Request, res: Response) => {
  const session = getCachedSessions().find(s => s.id === req.params.id);
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
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids array required" });
  }

  const deleted: string[] = [];
  const failed: string[] = [];
  const batch: DeleteRecord[] = [];

  for (const id of ids) {
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
  const session = getCachedSessions().find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ message: "Session not found" });

  const plat = os.platform();
  let cmd: string;
  if (plat === "win32") {
    cmd = `start cmd /k "claude --resume ${session.id}"`;
  } else if (plat === "darwin") {
    cmd = `osascript -e 'tell application "Terminal" to do script "claude --resume ${session.id}"'`;
  } else {
    cmd = `x-terminal-emulator -e "claude --resume ${session.id}" || xterm -e "claude --resume ${session.id}"`;
  }
  const child = exec(cmd);
  child.unref();
  res.json({ message: "Opening session", id: session.id });
});

export default router;
