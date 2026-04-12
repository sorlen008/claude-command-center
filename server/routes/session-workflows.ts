import { Router, type Request, type Response } from "express";
import { getCachedSessions } from "../scanner/session-scanner";
import { runAutoWorkflows } from "../scanner/auto-workflows";
import { storage } from "../storage";

const router = Router();

/** GET /api/sessions/workflows — Get workflow config */
router.get("/api/sessions/workflows", (_req: Request, res: Response) => {
  res.json(storage.getWorkflowConfig());
});

/** PATCH /api/sessions/workflows — Update workflow config */
router.patch("/api/sessions/workflows", (req: Request, res: Response) => {
  const body = req.body as Partial<import("@shared/types").WorkflowConfig>;
  const updated = storage.updateWorkflowConfig(body);
  res.json(updated);
});

/** POST /api/sessions/workflows/run — Run auto-workflows manually */
router.post("/api/sessions/workflows/run", async (_req: Request, res: Response) => {
  try {
    const sessions = getCachedSessions();
    const result = await runAutoWorkflows(sessions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

export default router;
