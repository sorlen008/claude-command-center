import { Router } from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { z } from "zod";
import { getCachedSessions } from "../scanner/session-scanner";
import { storage } from "../storage";
import { buildPlanUsage, loadPlanCatalog } from "../scanner/plan-usage";
import type { PlanUsageResponse } from "@shared/types";

const router = Router();

const CATALOG_DIR = path.join(os.homedir(), ".claude-command-center");
const OVERRIDE_CATALOG_PATH = path.join(CATALOG_DIR, "plan-catalog-override.json");

// Community-maintained catalog URL. Overridable via env for self-hosted forks.
const DEFAULT_CATALOG_URL = "https://raw.githubusercontent.com/sorlen008/claude-command-center/main/server/plan-catalog.json";

interface CacheEntry {
  result: PlanUsageResponse;
  ts: number;
  planId: string | null;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

router.get("/api/analytics/plan-usage", async (_req, res) => {
  try {
    const settings = storage.getAppSettings();
    const planId = settings.selectedPlanId ?? null;
    const apiKeyPresent = Boolean(process.env.ANTHROPIC_API_KEY);

    const now = Date.now();
    if (cache && cache.planId === planId && now - cache.ts < CACHE_TTL_MS) {
      return res.json(cache.result);
    }

    const sessions = getCachedSessions()
      .filter(s => !s.isEmpty && s.messageCount > 0)
      .map(s => ({
        id: s.id,
        filePath: s.filePath,
        projectKey: s.projectKey,
        firstTs: s.firstTs,
        lastTs: s.lastTs,
      }));

    const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
    const result = await buildPlanUsage(sessions, planId, apiKeyPresent, { claudeProjectsDir });
    cache = { result, ts: Date.now(), planId };
    res.json(result);
  } catch (err) {
    console.error("[plan-usage] Failed:", (err as Error).message);
    res.status(500).json({ message: "Failed to build plan usage", error: (err as Error).message });
  }
});

// Zod schema for catalog validation — strict enough to catch shape errors, loose
// enough to accept new fields added by future catalog versions.
const CatalogSchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  sourceNote: z.string().optional(),
  plans: z.array(z.object({
    id: z.enum(["free", "pro", "max5x", "max20x", "api"]),
    label: z.string(),
    priceUsdMonthly: z.number().min(0).max(10000),
    priceUsdAnnual: z.number().min(0).max(100000).nullable(),
    bestFor: z.string(),
    sessionWindow: z.object({
      durationHours: z.number().min(0.1).max(168),
      tokenLimit: z.number().nullable(),
      confidence: z.enum(["official", "estimate", "unknown"]),
    }),
    weekly: z.object({
      sonnetHoursMin: z.number().nullable(),
      sonnetHoursMax: z.number().nullable(),
      opusHoursMin: z.number().nullable(),
      opusHoursMax: z.number().nullable(),
      confidence: z.enum(["official", "estimate", "unknown"]),
    }),
    payPerToken: z.boolean(),
  })).min(1).max(20),
  throttleWindows: z.array(z.object({
    daysOfWeek: z.array(z.number().min(0).max(6)),
    startHourUtc: z.number().min(0).max(23),
    endHourUtc: z.number().min(0).max(23),
    note: z.string(),
  })).default([]),
});

router.post("/api/settings/refresh-catalog", async (_req, res) => {
  try {
    const url = process.env.PLAN_CATALOG_URL || DEFAULT_CATALOG_URL;
    const current = loadPlanCatalog();

    const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) {
      return res.status(502).json({ message: `Catalog fetch failed: ${response.status} ${response.statusText}` });
    }

    const text = await response.text();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      return res.status(502).json({ message: "Catalog response was not valid JSON" });
    }

    const validated = CatalogSchema.safeParse(parsedJson);
    if (!validated.success) {
      return res.status(502).json({ message: "Catalog failed schema validation", issues: validated.error.issues.slice(0, 5) });
    }

    const incoming = validated.data;
    const changed = incoming.version !== current.catalog.version || incoming.updatedAt !== current.catalog.updatedAt;

    fs.mkdirSync(CATALOG_DIR, { recursive: true });
    fs.writeFileSync(OVERRIDE_CATALOG_PATH, JSON.stringify(incoming, null, 2), "utf-8");
    cache = null; // invalidate plan-usage cache so next GET reflects new catalog

    res.json({
      updated: changed,
      previousVersion: current.catalog.version,
      newVersion: incoming.version,
      updatedAt: incoming.updatedAt,
      source: url,
    });
  } catch (err) {
    console.error("[plan-usage] refresh-catalog failed:", (err as Error).message);
    res.status(500).json({ message: "Failed to refresh catalog", error: (err as Error).message });
  }
});

router.get("/api/settings/plan-catalog", (_req, res) => {
  try {
    const { catalog, source } = loadPlanCatalog();
    res.json({ catalog, source });
  } catch (err) {
    console.error("[plan-usage] load-catalog failed:", (err as Error).message);
    res.status(500).json({ message: "Failed to load catalog" });
  }
});

export default router;
