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
