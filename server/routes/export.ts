import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { getDB, save } from "../db";

const router = Router();

const CustomNodeSchema = z.object({
  id: z.string().min(1).max(200),
  subType: z.enum(["service", "database", "api", "cicd", "deploy", "queue", "cache", "other"]),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  url: z.string().max(500).optional(),
  icon: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
  source: z.enum(["manual", "config-file", "api-config", "ai-suggested", "docker-compose", "auto-discovered"]),
});

const CustomEdgeSchema = z.object({
  id: z.string().min(1).max(300),
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  label: z.string().min(1).max(100),
  color: z.string().max(20).optional(),
  dashed: z.boolean().optional(),
  source_origin: z.enum(["manual", "config-file", "api-config", "ai-suggested", "docker-compose", "auto-discovered"]),
});

const ImportSchema = z.object({
  version: z.string(),
  customNodes: z.array(CustomNodeSchema).max(500).optional(),
  customEdges: z.array(CustomEdgeSchema).max(2000).optional(),
  entityOverrides: z.record(z.string(), z.object({
    description: z.string().max(1000).optional(),
    color: z.string().max(20).optional(),
    label: z.string().max(200).optional(),
  })).optional(),
  appSettings: z.object({
    appName: z.string().max(100),
    onboarded: z.boolean(),
    scanPaths: z.object({
      homeDir: z.string().nullable(),
      claudeDir: z.string().nullable(),
      extraMcpFiles: z.array(z.string()),
      extraProjectDirs: z.array(z.string()),
      extraSkillDirs: z.array(z.string()),
      extraPluginDirs: z.array(z.string()),
    }),
  }).optional(),
}).passthrough();

router.get("/api/export", (_req, res) => {
  res.json({
    entities: storage.getEntities(),
    relationships: storage.getAllRelationships(),
    customNodes: storage.getCustomNodes(),
    customEdges: storage.getCustomEdges(),
    entityOverrides: storage.getEntityOverrides(),
    appSettings: storage.getAppSettings(),
    exportedAt: new Date().toISOString(),
    version: "1.0.0",
  });
});

router.post("/api/import", (req, res) => {
  const result = ImportSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ message: "Invalid import data", errors: result.error.issues.slice(0, 5) });
  }

  const body = result.data;
  const db = getDB();
  const imported: Record<string, number> = {};

  if (body.customNodes) {
    db.customNodes = body.customNodes;
    imported.customNodes = body.customNodes.length;
  }
  if (body.customEdges) {
    db.customEdges = body.customEdges;
    imported.customEdges = body.customEdges.length;
  }
  if (body.entityOverrides) {
    db.entityOverrides = body.entityOverrides;
    imported.entityOverrides = Object.keys(body.entityOverrides).length;
  }
  if (body.appSettings) {
    db.appSettings = body.appSettings;
    imported.appSettings = 1;
  }

  save();
  res.json({ imported });
});

export default router;
