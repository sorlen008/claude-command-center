import { Router } from "express";
import { getCachedSessions } from "../scanner/session-scanner";
import { buildBurnAnalytics, type BurnAnalytics } from "../scanner/burn-analytics";

const router = Router();

let cached: BurnAnalytics | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

router.get("/api/analytics/burn", async (_req, res) => {
  try {
    const now = Date.now();
    if (cached && now - cacheTs < CACHE_TTL_MS) {
      return res.json(cached);
    }
    const sessions = getCachedSessions()
      .filter(s => !s.isEmpty && s.messageCount > 0)
      .map(s => ({ id: s.id, filePath: s.filePath, firstMessage: s.firstMessage }));
    const result = await buildBurnAnalytics(sessions);
    cached = result;
    cacheTs = Date.now();
    res.json(result);
  } catch (err) {
    console.error("[burn-analytics] Failed:", (err as Error).message);
    res.status(500).json({ message: "Failed to build burn analytics", error: (err as Error).message });
  }
});

export default router;
