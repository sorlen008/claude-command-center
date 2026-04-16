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
  BuildupPoint,
  HistoricalLimits,
  EstimatedCeiling,
  PlanDetectionHint,
} from "@shared/types";
import { buildHistoricalLimits } from "./historical-limits";

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

/**
 * Per-day usage for the last 7 calendar days, with cumulative running totals.
 * Used by the Billing tab "buildup" chart so the user can see how close they
 * are to each limit over time.
 */
export function buildWeeklyBuildup(turns: TurnWithCost[], now: Date = new Date()): BuildupPoint[] {
  const points: BuildupPoint[] = [];
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // Last 7 calendar days including today.
  for (let offset = 6; offset >= 0; offset--) {
    const dayStart = new Date(startOfToday);
    dayStart.setDate(dayStart.getDate() - offset);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayMs = dayStart.getTime();
    const nextMs = dayEnd.getTime();
    const inDay = turns.filter(t => t.ms >= dayMs && t.ms < nextMs);
    const sonnetHours = estimateActiveHours(inDay, isSonnet);
    const opusHours = estimateActiveHours(inDay, isOpus);
    const costUsd = Math.round(inDay.reduce((s, t) => s + t.cost, 0) * 10000) / 10000;
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateKey = `${dayStart.getFullYear()}-${pad(dayStart.getMonth() + 1)}-${pad(dayStart.getDate())}`;
    points.push({
      date: dateKey,
      sonnetHours,
      opusHours,
      costUsd,
      cumSonnetHours: 0,
      cumOpusHours: 0,
      cumCostUsd: 0,
    });
  }

  let cumSonnet = 0, cumOpus = 0, cumCost = 0;
  for (const p of points) {
    cumSonnet += p.sonnetHours;
    cumOpus += p.opusHours;
    cumCost += p.costUsd;
    p.cumSonnetHours = Math.round(cumSonnet * 10) / 10;
    p.cumOpusHours = Math.round(cumOpus * 10) / 10;
    p.cumCostUsd = Math.round(cumCost * 10000) / 10000;
  }
  return points;
}

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

/**
 * Plan-specific fallback session-window ceiling. Only used when the user has
 * zero past rate-limit hits — once real hits exist, their personal median
 * replaces this estimate everywhere in the UI.
 *
 * The numbers are rough: they assume ~500K active tokens per hour of model
 * use, multiplied by the *high end* of the plan's weekly Sonnet range
 * divided across 7 × 5h sessions per week. They're labeled "estimate" so
 * the user knows not to take them as law.
 */
export function fallbackSessionCeiling(plan: PlanDefinition | null): EstimatedCeiling {
  if (!plan) return { tokensPerSession: null, basis: "Select a plan to see an estimated ceiling.", confidence: "unknown" };
  if (plan.payPerToken) {
    return { tokensPerSession: null, basis: "API pay-as-you-go has no session-window cap.", confidence: "unknown" };
  }
  // Rough per-plan estimate of tokens allowed in one 5h session window.
  // Derived from Anthropic's published hours ranges, assuming typical users
  // burn ~500K tokens per active hour. See the comment above.
  const byId: Record<PlanId, number | null> = {
    free: 200_000,
    pro: 1_000_000,
    max5x: 3_500_000,
    max20x: 10_000_000,
    api: null,
  };
  const est = byId[plan.id];
  if (est === null || est === undefined) {
    return { tokensPerSession: null, basis: `No session-window estimate for ${plan.label}.`, confidence: "unknown" };
  }
  return {
    tokensPerSession: est,
    basis: `Rough estimate for ${plan.label} before your real ceiling is learned from rate-limit events.`,
    confidence: "estimate",
  };
}

/**
 * When a user's observed median is wildly outside the per-plan estimate band
 * for their selected plan, suggest a better fit. Non-blocking — purely advisory.
 */
export function detectPlanMismatch(
  selectedPlan: PlanDefinition | null,
  historicalLimits: HistoricalLimits,
): PlanDetectionHint | null {
  if (!selectedPlan || selectedPlan.payPerToken) return null;
  if (historicalLimits.sampleSize < 5 || historicalLimits.medianTokens === null) return null;

  const median = historicalLimits.medianTokens;

  // Token-band thresholds: anything below 700K is Pro-ish, 700K–5M is Max 5x, above 5M is Max 20x.
  const bandFor = (tokens: number): PlanId => {
    if (tokens < 700_000) return "pro";
    if (tokens < 5_000_000) return "max5x";
    return "max20x";
  };

  const observedBand = bandFor(median);
  if (observedBand === selectedPlan.id) return null;

  // Don't nag users on Max 20x that they might "only" need Max 5x — they have the
  // bigger plan for a reason. Only suggest *upgrading* from a cheaper plan.
  const upgradeOrder: PlanId[] = ["free", "pro", "max5x", "max20x"];
  const selectedIdx = upgradeOrder.indexOf(selectedPlan.id);
  const observedIdx = upgradeOrder.indexOf(observedBand);
  if (observedIdx <= selectedIdx) return null;

  const labels: Record<PlanId, string> = {
    free: "Free",
    pro: "Pro",
    max5x: "Max 5x",
    max20x: "Max 20x",
    api: "API",
  };

  return {
    suggestedPlanId: observedBand,
    suggestedPlanLabel: labels[observedBand],
    reason: `Your median at-hit token count is ~${(median / 1_000_000).toFixed(1)}M over ${historicalLimits.sampleSize} past hits — more consistent with ${labels[observedBand]} than ${selectedPlan.label}.`,
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
  const weeklyBuildup = buildWeeklyBuildup(turns, now);

  const historicalLimits: HistoricalLimits = await buildHistoricalLimits(sessions, {
    claudeProjectsDir: opts.claudeProjectsDir,
    windowHours: plan?.sessionWindow.durationHours ?? 5,
    now,
  });

  // Monthly = calendar month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthly = turns.length > 0 ? aggregatePeriod(turns, monthStart, now.getTime()) : null;

  const peakHours = buildPeakHoursGrid(turns);

  const predicted = (plan && weekly) ? predictLimitHit(turns, plan, weekly, now) : null;

  const billingMode: "subscription" | "api" | "unknown" =
    apiKeyPresent ? "api" : (selectedPlanId && selectedPlanId !== "api" ? "subscription" : "unknown");

  const estimatedCeiling = fallbackSessionCeiling(plan);
  const planDetectionHint = detectPlanMismatch(plan, historicalLimits);
  const noSessionsYet = sessions.length === 0;

  return {
    selectedPlanId,
    plan,
    billingModeDetected: billingMode,
    apiKeyPresent,
    currentSession: sessionWindow,
    weekly,
    weeklyBuildup,
    monthly,
    historicalLimits,
    estimatedCeiling,
    planDetectionHint,
    noSessionsYet,
    peakHours,
    throttleWindows: catalog.throttleWindows || [],
    predictedLimitHit: predicted,
    catalogVersion: catalog.version,
    catalogUpdatedAt: catalog.updatedAt,
    catalogSource: source,
    durationMs: Math.round(performance.now() - start),
  };
}
