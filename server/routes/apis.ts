import { Router, type Request, type Response } from "express";
import { scanApiConfig } from "../scanner/api-config-scanner";
import type { ApiDefinition } from "@shared/types";

const router = Router();

/** GET /api/apis — All API definitions from apis-config.yaml */
router.get("/api/apis", (_req: Request, res: Response) => {
  try {
    const { apis } = scanApiConfig();
    res.json(apis);
  } catch (err) {
    res.status(500).json({ message: "Failed to scan API config" });
  }
});

/** GET /api/apis/stats — Category and status counts */
router.get("/api/apis/stats", (_req: Request, res: Response) => {
  try {
    const { apis } = scanApiConfig();
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byAuth: Record<string, number> = {};

    for (const api of apis) {
      byCategory[api.category] = (byCategory[api.category] || 0) + 1;
      byStatus[api.status] = (byStatus[api.status] || 0) + 1;
      byAuth[api.authMethod] = (byAuth[api.authMethod] || 0) + 1;
    }

    res.json({ total: apis.length, byCategory, byStatus, byAuth });
  } catch (err) {
    res.status(500).json({ message: "Failed to compute API stats" });
  }
});

export default router;
