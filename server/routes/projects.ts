import { Router, type Request, type Response } from "express";
import { storage } from "../storage";

const router = Router();

router.get("/api/projects", (_req: Request, res: Response) => {
  const projects = storage.getEntities("project");

  const enriched = projects.map((project) => {
    const rels = storage.getRelationships(project.id);
    const mcpCount = rels.filter((r) => r.targetType === "mcp" || r.sourceType === "mcp").length;
    const skillCount = rels.filter((r) => r.targetType === "skill" || r.sourceType === "skill").length;
    const markdownCount = rels.filter((r) => r.targetType === "markdown" || r.sourceType === "markdown").length;
    return { ...project, mcpCount, skillCount, markdownCount };
  });

  res.json(enriched);
});

router.get("/api/projects/:id", (req: Request, res: Response) => {
  const project = storage.getEntity(req.params.id as string);
  if (!project || project.type !== "project") {
    return res.status(404).json({ message: "Project not found" });
  }

  const rels = storage.getRelationships(project.id);
  const linkedIds = rels.map((r) => (r.sourceId === project.id ? r.targetId : r.sourceId));
  const linkedEntities = linkedIds.map((id) => storage.getEntity(id)).filter(Boolean);

  res.json({ project, relationships: rels, linkedEntities });
});

export default router;
