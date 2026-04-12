import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";

const router = Router();

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

export default router;
