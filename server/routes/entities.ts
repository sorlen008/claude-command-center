import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import type { EntityType } from "@shared/types";

const router = Router();

router.get("/api/entities", (req: Request, res: Response) => {
  const type = (Array.isArray(req.query.type) ? req.query.type[0] : req.query.type) as EntityType | undefined;
  const q = (Array.isArray(req.query.q) ? req.query.q[0] : req.query.q) as string | undefined;
  const entities = storage.getEntities(type, q);
  res.json(entities);
});

router.get("/api/entities/:id", (req: Request, res: Response) => {
  const entity = storage.getEntity(req.params.id as string);
  if (!entity) return res.status(404).json({ message: "Entity not found" });
  res.json(entity);
});

router.get("/api/entities/:id/relationships", (req: Request, res: Response) => {
  const rels = storage.getRelationships(req.params.id as string);
  res.json(rels);
});

export default router;
