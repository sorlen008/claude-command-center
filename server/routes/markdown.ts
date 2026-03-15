import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import fs from "fs";
import path from "path";

const router = Router();

function qstr(val: unknown): string | undefined {
  if (Array.isArray(val)) return val[0] as string;
  return val as string | undefined;
}

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

  try {
    const content = fs.readFileSync(entity.path, "utf-8");
    res.json({ ...entity, content });
  } catch {
    res.status(500).json({ message: "Could not read file" });
  }
});

router.put("/api/markdown/:id", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity || entity.type !== "markdown") {
    return res.status(404).json({ message: "Markdown file not found" });
  }

  const { content } = req.body;
  if (typeof content !== "string") {
    return res.status(400).json({ message: "Content must be a string" });
  }

  try {
    const oldContent = fs.readFileSync(entity.path, "utf-8");
    storage.createBackup(entity.path, oldContent, "edit");
    fs.writeFileSync(entity.path, content, "utf-8");
    res.json({ message: "Saved", path: entity.path });
  } catch {
    res.status(500).json({ message: "Could not write file" });
  }
});

router.post("/api/markdown", (req: Request, res: Response) => {
  const { filePath, content } = req.body;
  if (!filePath || typeof content !== "string") {
    return res.status(400).json({ message: "filePath and content required" });
  }

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    res.json({ message: "Created", path: filePath });
  } catch {
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
  const backup = storage.getBackup(backupId);
  if (!backup) {
    return res.status(404).json({ message: "Backup not found" });
  }

  try {
    const currentContent = fs.readFileSync(entity.path, "utf-8");
    storage.createBackup(entity.path, currentContent, "pre-restore");
    fs.writeFileSync(entity.path, backup.content, "utf-8");
    res.json({ message: "Restored", path: entity.path });
  } catch {
    res.status(500).json({ message: "Could not restore file" });
  }
});

export default router;
