import { Router, type Request, type Response } from "express";
import { getLiveData } from "../scanner/live-scanner";

const router = Router();

/** GET /api/live — Full live data bundle */
router.get("/api/live", (_req: Request, res: Response) => {
  const data = getLiveData();
  res.json(data);
});

export default router;
