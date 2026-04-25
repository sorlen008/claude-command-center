import { Router, type Request, type Response } from "express";
import fs from "fs";
import { storage } from "../storage";

const router = Router();

const MAX_PREVIEW_LINES = 500;
const MAX_PREVIEW_BYTES = 256 * 1024; // 256 KB cap to avoid streaming gigantic files

/**
 * GET /api/scripts/:id/source
 *
 * Returns the first 500 lines of a script's source for the read-only preview
 * modal. The script must exist in the entity DB — we never read an arbitrary
 * filesystem path from the request, only paths the scanner already enumerated.
 */
router.get("/api/scripts/:id/source", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const entity = storage.getEntity(id);
  if (!entity || entity.type !== "script") {
    return res.status(404).json({ message: "Script not found" });
  }

  const filePath = entity.path;
  if (!filePath) {
    return res.status(404).json({ message: "Script has no source path" });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(410).json({ message: "Script file no longer exists on disk" });
  }

  let content: string;
  try {
    if (stat.size <= MAX_PREVIEW_BYTES) {
      content = fs.readFileSync(filePath, "utf-8");
    } else {
      // Read just the first chunk for huge files.
      const fd = fs.openSync(filePath, "r");
      try {
        const buf = Buffer.alloc(MAX_PREVIEW_BYTES);
        const bytesRead = fs.readSync(fd, buf, 0, MAX_PREVIEW_BYTES, 0);
        content = buf.subarray(0, bytesRead).toString("utf-8");
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (err) {
    return res.status(500).json({ message: "Failed to read script", error: (err as Error).message });
  }

  const lines = content.split(/\r?\n/);
  const truncated = lines.length > MAX_PREVIEW_LINES || stat.size > MAX_PREVIEW_BYTES;
  const preview = lines.slice(0, MAX_PREVIEW_LINES).join("\n");

  res.json({
    id: entity.id,
    name: entity.name,
    path: filePath,
    sizeBytes: stat.size,
    lineCount: lines.length,
    previewLines: Math.min(lines.length, MAX_PREVIEW_LINES),
    truncated,
    content: preview,
  });
});

export default router;
