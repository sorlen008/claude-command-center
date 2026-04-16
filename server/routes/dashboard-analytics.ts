import { Router } from "express";
import path from "path";
import os from "os";
import { getCachedSessions } from "../scanner/session-scanner";
import { buildDashboardAnalytics, type DashboardAnalytics, type TimeRange } from "../scanner/dashboard-analytics";

const router = Router();

const VALID_RANGES = new Set<TimeRange>(["today", "7d", "30d", "month", "all"]);

interface CacheEntry {
  result: DashboardAnalytics;
  ts: number;
}

const cache = new Map<TimeRange, CacheEntry>();

function ttlForRange(range: TimeRange): number {
  return range === "all" ? 10 * 60 * 1000 : 5 * 60 * 1000;
}

router.get("/api/analytics/dashboard", async (req, res) => {
  try {
    const raw = typeof req.query.range === "string" ? req.query.range : "30d";
    if (!VALID_RANGES.has(raw as TimeRange)) {
      return res.status(400).json({ message: `Invalid range: ${raw}. Must be one of today|7d|30d|month|all.` });
    }
    const range = raw as TimeRange;

    const existing = cache.get(range);
    if (existing && Date.now() - existing.ts < ttlForRange(range)) {
      return res.json(existing.result);
    }

    const sessions = getCachedSessions()
      .filter(s => !s.isEmpty && s.messageCount > 0)
      .map(s => ({
        id: s.id,
        filePath: s.filePath,
        projectKey: s.projectKey,
        firstTs: s.firstTs,
        lastTs: s.lastTs,
        firstMessage: s.firstMessage,
      }));

    const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
    const result = await buildDashboardAnalytics(sessions, range, { claudeProjectsDir });
    cache.set(range, { result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error("[dashboard-analytics] Failed:", (err as Error).message);
    res.status(500).json({ message: "Failed to build dashboard analytics", error: (err as Error).message });
  }
});

export default router;
