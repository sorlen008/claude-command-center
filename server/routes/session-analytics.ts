import { Router, type Request, type Response } from "express";
import { getCachedSessions } from "../scanner/session-scanner";
import { getCostAnalytics, getFileHeatmap, getHealthAnalytics, getStaleAnalytics } from "../scanner/session-analytics";
import { getProjectDashboards } from "../scanner/project-dashboard";
import { generateWeeklyDigest } from "../scanner/weekly-digest";
import { getBashKnowledgeBase, searchBashCommands } from "../scanner/bash-knowledge";
import { qstr } from "./validation";

const router = Router();

/** GET /api/sessions/analytics/costs — Cost analytics across all sessions */
router.get("/api/sessions/analytics/costs", (_req: Request, res: Response) => {
  res.json(getCostAnalytics(getCachedSessions()));
});

/** GET /api/sessions/analytics/files — File heatmap */
router.get("/api/sessions/analytics/files", (_req: Request, res: Response) => {
  res.json(getFileHeatmap(getCachedSessions()));
});

/** GET /api/sessions/analytics/health — Session health scores */
router.get("/api/sessions/analytics/health", (_req: Request, res: Response) => {
  res.json(getHealthAnalytics(getCachedSessions()));
});

/** GET /api/sessions/analytics/stale — Stale session suggestions */
router.get("/api/sessions/analytics/stale", (_req: Request, res: Response) => {
  res.json(getStaleAnalytics(getCachedSessions()));
});

/** GET /api/sessions/analytics/projects — Project dashboards */
router.get("/api/sessions/analytics/projects", (_req: Request, res: Response) => {
  res.json(getProjectDashboards(getCachedSessions()));
});

/** GET /api/sessions/analytics/digest — Weekly digest */
router.get("/api/sessions/analytics/digest", (_req: Request, res: Response) => {
  res.json(generateWeeklyDigest(getCachedSessions()));
});

/** GET /api/sessions/analytics/bash — Bash command knowledge base */
router.get("/api/sessions/analytics/bash", (_req: Request, res: Response) => {
  res.json(getBashKnowledgeBase(getCachedSessions()));
});

/** GET /api/sessions/analytics/bash/search — Search bash commands */
router.get("/api/sessions/analytics/bash/search", (req: Request, res: Response) => {
  const q = qstr(req.query.q);
  if (!q) return res.status(400).json({ message: "q parameter required" });
  res.json(searchBashCommands(getCachedSessions(), q));
});

export default router;
