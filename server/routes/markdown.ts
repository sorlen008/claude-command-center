import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import fs from "fs";
import path from "path";
import { qstr, validate, validateMarkdownPath } from "./validation";
import { validateClaudeMd } from "../scanner/claudemd-validator";

const MarkdownContentSchema = z.object({
  content: z.string().max(1_000_000, "Content too large (max 1MB)"),
});

const MarkdownMetaSchema = z.object({
  locked: z.boolean().optional(),
  pinned: z.boolean().optional(),
}).strict();

const MarkdownCreateSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  content: z.string().max(1_000_000, "Content too large (max 1MB)"),
});

const router = Router();

router.get("/api/markdown", (req: Request, res: Response) => {
  const category = qstr(req.query.category);
  let markdowns = storage.getEntities("markdown");
  if (category) {
    markdowns = markdowns.filter((m) => (m.data as Record<string, unknown>).category === category);
  }
  res.json(markdowns);
});

/** GET /api/markdown/search?q=... — Search within all markdown file contents */
router.get("/api/markdown/search", (req: Request, res: Response) => {
  const q = qstr(req.query.q)?.toLowerCase();
  if (!q || q.length < 2) return res.json([]);

  const entities = storage.getEntities("markdown");
  const results: Array<{ fileId: string; fileName: string; filePath: string; category: string; matches: Array<{ line: number; text: string }>; matchCount: number }> = [];

  for (const entity of entities) {
    const safePath = validateMarkdownPath(entity.path);
    if (!safePath) continue;
    try {
      const content = fs.readFileSync(safePath, "utf-8");
      const lines = content.split("\n");
      const matches: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          matches.push({ line: i + 1, text: lines[i].slice(0, 200) });
          if (matches.length >= 5) break;
        }
      }
      if (matches.length > 0) {
        results.push({
          fileId: entity.id,
          fileName: entity.name,
          filePath: entity.path,
          category: (entity.data as Record<string, unknown>).category as string,
          matches,
          matchCount: matches.length,
        });
      }
    } catch {}
  }

  res.json(results.slice(0, 20));
});

/** GET /api/markdown/context-summary — Summary of all context loaded by Claude */
router.get("/api/markdown/context-summary", (_req: Request, res: Response) => {
  const entities = storage.getEntities("markdown");
  const claudeMdFiles: Array<{ name: string; lines: number; tokens: number; sections: number }> = [];
  const memoryFiles: Array<{ name: string; type: string; lines: number; tokens: number }> = [];
  const skillFiles: Array<{ name: string; slash: string }> = [];
  let totalLines = 0;
  let totalTokens = 0;
  let memoryMdLines = 0;

  for (const e of entities) {
    const data = e.data as Record<string, unknown>;
    const lines = (data.lineCount as number) || 0;
    const tokens = (data.tokenEstimate as number) || Math.ceil(((data.sizeBytes as number) || 0) / 4);
    const cat = data.category as string;
    const fm = data.frontmatter as Record<string, unknown> | null;
    const sections = (data.sections as unknown[])?.length || 0;

    if (cat === "claude-md") {
      claudeMdFiles.push({ name: e.name, lines, tokens, sections });
      totalLines += lines;
      totalTokens += tokens;
    } else if (cat === "memory") {
      if (e.name === "MEMORY.md") memoryMdLines = lines;
      const memType = typeof fm?.type === "string" ? fm.type : "unknown";
      memoryFiles.push({ name: e.name, type: memType, lines, tokens });
      totalLines += lines;
      totalTokens += tokens;
    } else if (cat === "skill") {
      const parts = e.path.replace(/\\/g, "/").split("/");
      const si = parts.indexOf("skills");
      const slash = si >= 0 && parts[si + 1] ? `/${parts[si + 1]}` : "";
      skillFiles.push({ name: e.name, slash });
    }
  }

  res.json({
    claudeMdFiles,
    memoryFiles,
    skillFiles,
    totalLines,
    totalTokens,
    memoryMdUsage: { lines: memoryMdLines, limit: 200, percentage: Math.round((memoryMdLines / 200) * 100) },
  });
});

/** GET /api/markdown/meta — All file metadata */
router.get("/api/markdown/meta", (_req: Request, res: Response) => {
  res.json(storage.getAllMarkdownMeta());
});

router.get("/api/markdown/:id", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }

  // Re-validate path is under home directory
  const safePath = validateMarkdownPath(entity.path);
  if (!safePath) {
    return res.status(403).json({ message: "Path must be under user home directory" });
  }

  try {
    const content = fs.readFileSync(safePath, "utf-8");
    res.json({ ...entity, content });
  } catch (err) {
    console.error("[markdown] Failed to read file:", (err as Error).message);
    res.status(500).json({ message: "Could not read file" });
  }
});

router.put("/api/markdown/:id", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }

  const parsed = validate(MarkdownContentSchema, req.body, res);
  if (!parsed) return;
  const { content } = parsed;

  // Re-validate entity path is still under home directory
  const safePath = validateMarkdownPath(entity.path);
  if (!safePath) {
    return res.status(403).json({ message: "Path must be under user home directory" });
  }

  try {
    const oldContent = fs.readFileSync(safePath, "utf-8");
    storage.createBackup(safePath, oldContent, "edit");
    fs.writeFileSync(safePath, content, "utf-8");
    res.json({ message: "Saved", path: safePath });
  } catch (err) {
    console.error("[markdown] Failed to write file:", (err as Error).message);
    res.status(500).json({ message: "Could not write file" });
  }
});

router.post("/api/markdown", (req: Request, res: Response) => {
  const parsed = validate(MarkdownCreateSchema, req.body, res);
  if (!parsed) return;
  const { filePath, content } = parsed;

  // Validate path is under home directory to prevent arbitrary file writes
  const safePath = validateMarkdownPath(filePath);
  if (!safePath) {
    return res.status(403).json({ message: "Path must be under user home directory" });
  }

  try {
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(safePath, content, "utf-8");
    res.json({ message: "Created", path: safePath });
  } catch (err) {
    console.error("[markdown] Failed to create file:", (err as Error).message);
    res.status(500).json({ message: "Could not create file" });
  }
});

router.get("/api/markdown/:id/history", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }

  const backups = storage.getBackups(entity.path);
  const summary = backups.map((b) => ({
    id: b.id,
    createdAt: b.createdAt,
    reason: b.reason,
    sizeBytes: b.content.length,
  }));
  res.json(summary);
});

router.post("/api/markdown/:id/restore/:backupId", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }

  const backupId = parseInt(req.params.backupId as string, 10);
  if (isNaN(backupId)) {
    return res.status(400).json({ message: "Invalid backup ID" });
  }

  const backup = storage.getBackup(backupId);
  if (!backup) {
    return res.status(404).json({ message: "Backup not found" });
  }

  // Ensure backup belongs to this entity's file
  if (backup.filePath !== entity.path) {
    return res.status(400).json({ message: "Backup does not belong to this file" });
  }

  // Re-validate path is under home directory
  const safePath = validateMarkdownPath(entity.path);
  if (!safePath) {
    return res.status(403).json({ message: "Path must be under user home directory" });
  }

  try {
    const currentContent = fs.readFileSync(safePath, "utf-8");
    storage.createBackup(safePath, currentContent, "pre-restore");
    fs.writeFileSync(safePath, backup.content, "utf-8");
    res.json({ message: "Restored", path: safePath });
  } catch (err) {
    console.error("[markdown] Failed to restore file:", (err as Error).message);
    res.status(500).json({ message: "Could not restore file" });
  }
});

/** PATCH /api/markdown/:id/meta — Update file metadata (lock, pin) */
router.patch("/api/markdown/:id/meta", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }
  const body = validate(MarkdownMetaSchema, req.body, res);
  if (!body) return;
  storage.setMarkdownMeta(entity.path, body);
  res.json({ message: "Updated", meta: storage.getMarkdownMeta(entity.path) });
});

/** GET /api/markdown/:id/backup/:backupId — Get backup content for diff */
router.get("/api/markdown/:id/backup/:backupId", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }
  const backupId = parseInt(req.params.backupId as string, 10);
  if (isNaN(backupId)) return res.status(400).json({ message: "Invalid backup ID" });
  const backup = storage.getBackup(backupId);
  if (!backup || backup.filePath !== entity.path) {
    return res.status(404).json({ message: "Backup not found" });
  }
  res.json({ id: backup.id, content: backup.content, createdAt: backup.createdAt, reason: backup.reason });
});

router.get("/api/markdown/:id/validate", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }

  const safePath = validateMarkdownPath(entity.path);
  if (!safePath) {
    return res.status(403).json({ message: "Path must be under user home directory" });
  }

  try {
    const result = validateClaudeMd(safePath);
    res.json(result);
  } catch (err) {
    console.error("[markdown] Validation failed:", (err as Error).message);
    res.status(500).json({ message: "Validation failed" });
  }
});

export default router;
