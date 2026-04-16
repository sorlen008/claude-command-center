import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { extractTurns, type RawTurn } from "./turn-extractor";
import { getPricing, computeCost } from "./pricing";
import type {
  PlanCatalog,
  PlanDefinition,
  PlanId,
  PlanUsageResponse,
  SessionWindowUsage,
  PeriodUsage,
  PeakHoursGrid,
  PredictedLimitHit,
} from "@shared/types";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_CATALOG_PATH = path.join(THIS_DIR, "..", "plan-catalog.json");
const OVERRIDE_CATALOG_PATH = path.join(os.homedir(), ".claude-command-center", "plan-catalog-override.json");

interface TurnWithCost {
  ts: string;
  ms: number;
  model: string;
  activeTokens: number;
  cost: number;
}

interface SessionMetaLite {
  id: string;
  filePath: string;
  projectKey: string;
  firstTs: string | null;
  lastTs: string | null;
}

/** Load the plan catalog, preferring the override file written by the refresh endpoint. */
export function loadPlanCatalog(): { catalog: PlanCatalog; source: "bundled" | "override" } {
  if (fs.existsSync(OVERRIDE_CATALOG_PATH)) {
    try {
      const raw = fs.readFileSync(OVERRIDE_CATALOG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as PlanCatalog;
      if (parsed && Array.isArray(parsed.plans)) {
        return { catalog: parsed, source: "override" };
      }
    } catch {
      // fall through to bundled
    }
  }
  const raw = fs.readFileSync(BUNDLED_CATALOG_PATH, "utf-8");
  return { catalog: JSON.parse(raw) as PlanCatalog, source: "bundled" };
}

export function findPlan(catalog: PlanCatalog, planId: PlanId | null | undefined): PlanDefinition | null {
  if (!planId) return null;
  return catalog.plans.find(p => p.id === planId) || null;
}

/**
 * Flatten all turns across sessions + subagent files into a single chronologically
 * sorted array with cost attached. Used for both session-window reconstruction and
 * for the peak-hours heatmap.
 */
async function collectAllTurns(sessions: SessionMetaLite[], claudeProjectsDir: string): Promise<TurnWithCost[]> {
  const all: TurnWithCost[] = [];

  const BATCH = 20;
  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (s) => {
      const parent = await extractTurns(s.filePath);
      const subDir = path.join(claudeProjectsDir, s.projectKey, s.id, "subagents");
      const subFiles = fs.existsSync(subDir)
        ? fs.readdirSync(subDir).filter(f => f.startsWith("agent-") && f.endsWith(".jsonl")).map(f => path.join(subDir, f))
        : [];
      const subs = await Promise.all(subFiles.map(fp => extractTurns(fp)));
      const combined: RawTurn[] = [...parent.turns];
      for (const sub of subs) combined.push(...sub.turns);
      return combined;
    }));

    for (const turns of results) {
      for (const t of turns) {
        if (!t.ts) continue;
        const ms = Date.parse(t.ts);
        if (!Number.isFinite(ms)) continue;
        const active = t.inputTokens + t.outputTokens + t.cacheCreationTokens;
        const cost = computeCost(getPricing(t.model), t.inputTokens, t.outputTokens, t.cacheReadTokens, t.cacheCreationTokens);
        all.push({ ts: t.ts, ms, model: t.model, activeTokens: active, cost });
      }
    }
  }

  all.sort((a, b) => a.ms - b.ms);
  return all;
}

/**
 * Reconstruct the current 5-hour session window.
 * Anthropic opens a new session when the gap since the last turn exceeds `durationHours`.
 * We walk backwards from the most recent turn, grouping consecutive turns whose
 * gap-to-previous is < durationHours; that cluster is the current window.
 */
export function detectCurrentWindow(turns: TurnWithCost[], durationHours: number, now: Date = new Date()): SessionWindowUsage | null {
  if (turns.length === 0) return null;
  const windowMs = durationHours * 60 * 60 * 1000;
  const nowMs = now.getTime();

  // Only consider turns within a 24-hour look-back — anything older is definitely a different session.
  const cutoffMs = nowMs - 24 * 60 * 60 * 1000;
  const recent = turns.filter(t => t.ms >= cutoffMs);
  if (recent.length === 0) return null;

  // Walk backwards: the window starts at the earliest turn within `durationHours`
  // of the most recent turn where the gap between consecutive turns never exceeds durationHours.
  const sorted = recent.slice().sort((a, b) => b.ms - a.ms); // newest first
  const mostRecentMs = sorted[0].ms;

  // If the most recent turn is already older than durationHours ago, there's no active window.
  if (nowMs - mostRecentMs > windowMs) return null;

  let windowStartMs = mostRecentMs;
  const included: TurnWithCost[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i];
    if (mostRecentMs - t.ms > windowMs) break;
    included.push(t);
    windowStartMs = t.ms;
  }

  const tokensUsed = included.reduce((s, t) => s + t.activeTokens, 0);
  const costUsd = Math.round(included.reduce((s, t) => s + t.cost, 0) * 10000) / 10000;
  const resetAtMs = windowStartMs + windowMs;

  return {
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(nowMs).toISOString(),
    resetAtIso: new Date(resetAtMs).toISOString(),
    tokensUsed,
    costUsd,
    turnsInWindow: included.length,
  };
}

/**
 * Rough "active hours" estimate: Anthropic measures weekly caps as "hours of model use."
 * Since we don't get explicit timing from JSONL, we estimate 1 hour = the elapsed wall time
 * between the first and last turn of every 5-hour session window the model was engaged in.
 * Computed per-model family via summing time-between-consecutive-turns capped at 30 min.
 */
function estimateActiveHours(turns: TurnWithCost[], familyPredicate: (model: string) => boolean): number {
  const relevant = turns.filter(t => familyPredicate(t.model));
  if (relevant.length < 2) return 0;
  const CAP_MS = 30 * 60 * 1000;
  let totalMs = 0;
  for (let i = 1; i < relevant.length; i++) {
    const gap = relevant[i].ms - relevant[i - 1].ms;
    if (gap > 0 && gap < CAP_MS) totalMs += gap;
  }
  return Math.round((totalMs / (60 * 60 * 1000)) * 10) / 10;
}

function isOpus(model: string): boolean { return /opus/i.test(model); }
function isSonnet(model: string): boolean { return /sonnet/i.test(model); }

export function aggregatePeriod(turns: TurnWithCost[], startMs: number, endMs: number): PeriodUsage {
  const inRange = turns.filter(t => t.ms >= startMs && t.ms <= endMs);
  const tokensUsed = inRange.reduce((s, t) => s + t.activeTokens, 0);
  const costUsd = Math.round(inRange.reduce((s, t) => s + t.cost, 0) * 10000) / 10000;
  return {
    periodStartIso: new Date(startMs).toISOString(),
    periodEndIso: new Date(endMs).toISOString(),
    tokensUsed,
    costUsd,
    sonnetHours: estimateActiveHours(inRange, isSonnet),
    opusHours: estimateActiveHours(inRange, isOpus),
  };
}

/**
 * 7×24 heatmap of avg cost per (day-of-week, hour-of-day) cell, normalized by
 * the number of calendar-weeks the dataset spans.
 */
export function buildPeakHoursGrid(turns: TurnWithCost[]): PeakHoursGrid {
  const costGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const tokenGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  if (turns.length === 0) return { costByDayHour: costGrid, tokensByDayHour: tokenGrid, timezone: "local" };

  for (const t of turns) {
    const d = new Date(t.ms);
    costGrid[d.getDay()][d.getHours()] += t.cost;
    tokenGrid[d.getDay()][d.getHours()] += t.activeTokens;
  }

  const firstMs = turns[0].ms;
  const lastMs = turns[turns.length - 1].ms;
  const spanWeeks = Math.max(1, (lastMs - firstMs) / (7 * 24 * 60 * 60 * 1000));

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      costGrid[d][h] = Math.round((costGrid[d][h] / spanWeeks) * 10000) / 10000;
      tokenGrid[d][h] = Math.round(tokenGrid[d][h] / spanWeeks);
    }
  }

  return {
    costByDayHour: costGrid,
    tokensByDayHour: tokenGrid,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
  };
}

/**
 * Linear burn-rate prediction: if the user's current session is at X% of the low-end
 * weekly Sonnet range and the trailing-24h cost rate continues, when will they hit 100%?
 */
export function predictLimitHit(
  turns: TurnWithCost[],
  plan: PlanDefinition,
  weekly: PeriodUsage,
  now: Date = new Date()
): PredictedLimitHit | null {
  if (!plan.weekly.sonnetHoursMin || weekly.sonnetHours <= 0) return null;

  const limit = plan.weekly.sonnetHoursMin;
  if (weekly.sonnetHours >= limit) {
    return {
      periodicity: "weekly",
      hitAtIso: now.toISOString(),
      confidence: "high",
      note: `Already past the low-end Sonnet weekly estimate (${limit}h).`,
    };
  }

  // Trailing 24h rate in sonnet-hours
  const dayAgoMs = now.getTime() - 24 * 60 * 60 * 1000;
  const recentSonnet = turns.filter(t => t.ms >= dayAgoMs && isSonnet(t.model));
  if (recentSonnet.length < 2) return null;

  const recentHours = estimateActiveHours(recentSonnet, isSonnet);
  if (recentHours <= 0) return null;

  const remainingHours = limit - weekly.sonnetHours;
  const hoursToLimit = (remainingHours / recentHours) * 24; // wall-clock hours

  const confidence: "low" | "medium" | "high" =
    recentSonnet.length < 10 ? "low" : recentSonnet.length < 40 ? "medium" : "high";

  return {
    periodicity: "weekly",
    hitAtIso: new Date(now.getTime() + hoursToLimit * 60 * 60 * 1000).toISOString(),
    confidence,
    note: `At the past-24h burn rate (~${recentHours}h Sonnet in 24h), you'd reach the ${limit}h low-end weekly estimate in about ${Math.round(hoursToLimit)}h.`,
  };
}

export async function buildPlanUsage(
  sessions: SessionMetaLite[],
  selectedPlanId: PlanId | null,
  apiKeyPresent: boolean,
  opts: { claudeProjectsDir: string; now?: Date }
): Promise<PlanUsageResponse> {
  const start = performance.now();
  const now = opts.now || new Date();
  const { catalog, source } = loadPlanCatalog();
  const plan = findPlan(catalog, selectedPlanId);

  const turns = await collectAllTurns(sessions, opts.claudeProjectsDir);

  // Current session window
  const sessionWindow = detectCurrentWindow(turns, plan?.sessionWindow.durationHours ?? 5, now);

  // Weekly = rolling 7 days
  const weekStartMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const weekly = turns.length > 0 ? aggregatePeriod(turns, weekStartMs, now.getTime()) : null;

  // Monthly = calendar month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthly = turns.length > 0 ? aggregatePeriod(turns, monthStart, now.getTime()) : null;

  const peakHours = buildPeakHoursGrid(turns);

  const predicted = (plan && weekly) ? predictLimitHit(turns, plan, weekly, now) : null;

  const billingMode: "subscription" | "api" | "unknown" =
    apiKeyPresent ? "api" : (selectedPlanId && selectedPlanId !== "api" ? "subscription" : "unknown");

  return {
    selectedPlanId,
    plan,
    billingModeDetected: billingMode,
    apiKeyPresent,
    currentSession: sessionWindow,
    weekly,
    monthly,
    peakHours,
    throttleWindows: catalog.throttleWindows || [],
    predictedLimitHit: predicted,
    catalogVersion: catalog.version,
    catalogUpdatedAt: catalog.updatedAt,
    catalogSource: source,
    durationMs: Math.round(performance.now() - start),
  };
}
