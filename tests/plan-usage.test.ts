import { describe, it, expect } from "vitest";
import {
  computeRangeCutoff,
} from "../server/scanner/dashboard-analytics";
import {
  detectCurrentWindow,
  aggregatePeriod,
  buildPeakHoursGrid,
  predictLimitHit,
  findPlan,
  loadPlanCatalog,
  buildWeeklyBuildup,
  fallbackSessionCeiling,
  detectPlanMismatch,
} from "../server/scanner/plan-usage";
import type { PlanDefinition, PeriodUsage, HistoricalLimits, PlanId } from "@shared/types";

function turn(ts: string, activeTokens: number, model = "claude-sonnet-4-6", cost = 0): { ts: string; ms: number; model: string; activeTokens: number; cost: number } {
  return { ts, ms: Date.parse(ts), model, activeTokens, cost };
}

describe("detectCurrentWindow (5-hour rolling reconstruction)", () => {
  const now = new Date("2026-04-16T14:00:00Z");

  it("returns null for empty input", () => {
    expect(detectCurrentWindow([], 5, now)).toBeNull();
  });

  it("groups consecutive turns inside the 5h window", () => {
    const turns = [
      turn("2026-04-16T10:00:00Z", 1000),
      turn("2026-04-16T11:00:00Z", 2000),
      turn("2026-04-16T13:00:00Z", 3000),
    ];
    const w = detectCurrentWindow(turns, 5, now)!;
    expect(w).not.toBeNull();
    expect(w.tokensUsed).toBe(6000);
    expect(w.turnsInWindow).toBe(3);
    expect(w.windowStartIso).toBe("2026-04-16T10:00:00.000Z");
  });

  it("returns null when the most recent turn is older than the window", () => {
    // now = 14:00, most recent turn at 08:00 = 6h ago > 5h window
    const turns = [turn("2026-04-16T08:00:00Z", 1000)];
    expect(detectCurrentWindow(turns, 5, now)).toBeNull();
  });

  it("stops extending the window at the 5-hour boundary", () => {
    const turns = [
      turn("2026-04-16T06:00:00Z", 10000), // 8h before "now" — should be excluded
      turn("2026-04-16T10:00:00Z", 1000),
      turn("2026-04-16T13:00:00Z", 500),
    ];
    const w = detectCurrentWindow(turns, 5, now)!;
    expect(w.tokensUsed).toBe(1500);
    expect(w.turnsInWindow).toBe(2);
  });
});

describe("aggregatePeriod", () => {
  it("sums tokens and costs within a range", () => {
    const turns = [
      turn("2026-04-10T10:00:00Z", 1000, "claude-sonnet-4-6", 0.1),
      turn("2026-04-12T12:00:00Z", 2000, "claude-sonnet-4-6", 0.2),
      turn("2026-04-16T14:00:00Z", 500, "claude-opus-4-6", 0.05),
    ];
    const startMs = Date.parse("2026-04-11T00:00:00Z");
    const endMs = Date.parse("2026-04-20T00:00:00Z");
    const p = aggregatePeriod(turns, startMs, endMs);
    expect(p.tokensUsed).toBe(2500);
    expect(p.costUsd).toBeCloseTo(0.25, 5);
  });
});

describe("buildPeakHoursGrid", () => {
  it("returns 7x24 zero grid for empty input", () => {
    const grid = buildPeakHoursGrid([]);
    expect(grid.costByDayHour.length).toBe(7);
    expect(grid.costByDayHour[0].length).toBe(24);
    expect(grid.costByDayHour.flat().every(v => v === 0)).toBe(true);
  });

  it("accumulates cost into the correct day/hour cell", () => {
    // 2026-04-15 = Wednesday (day 3), 14:00 local
    const turns = [turn("2026-04-15T14:00:00", 1000, "claude-sonnet-4-6", 0.5)];
    const grid = buildPeakHoursGrid(turns);
    // sum of grid equals the cost (spanWeeks=1 since single turn)
    const total = grid.costByDayHour.flat().reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(0.5, 3);
  });
});

describe("predictLimitHit", () => {
  const now = new Date("2026-04-16T14:00:00Z");
  const proPlan: PlanDefinition = {
    id: "pro",
    label: "Pro",
    priceUsdMonthly: 20,
    priceUsdAnnual: 200,
    bestFor: "",
    sessionWindow: { durationHours: 5, tokenLimit: null, confidence: "official" },
    weekly: { sonnetHoursMin: 40, sonnetHoursMax: 80, opusHoursMin: null, opusHoursMax: null, confidence: "official" },
    payPerToken: false,
  };

  it("returns null when weekly usage is zero", () => {
    const weekly: PeriodUsage = { periodStartIso: "", periodEndIso: "", tokensUsed: 0, costUsd: 0, sonnetHours: 0, opusHours: 0 };
    expect(predictLimitHit([], proPlan, weekly, now)).toBeNull();
  });

  it("flags already-past when usage exceeds the low-end limit", () => {
    const weekly: PeriodUsage = { periodStartIso: "", periodEndIso: "", tokensUsed: 0, costUsd: 0, sonnetHours: 45, opusHours: 0 };
    const p = predictLimitHit([], proPlan, weekly, now)!;
    expect(p).not.toBeNull();
    expect(p.note).toContain("Already past");
  });

  it("returns null when plan has no confirmed weekly limit", () => {
    const freePlan: PlanDefinition = { ...proPlan, id: "free", weekly: { sonnetHoursMin: null, sonnetHoursMax: null, opusHoursMin: null, opusHoursMax: null, confidence: "unknown" } };
    const weekly: PeriodUsage = { periodStartIso: "", periodEndIso: "", tokensUsed: 0, costUsd: 0, sonnetHours: 10, opusHours: 0 };
    expect(predictLimitHit([], freePlan, weekly, now)).toBeNull();
  });
});

describe("loadPlanCatalog + findPlan", () => {
  it("loads bundled catalog and finds each plan", () => {
    const { catalog, source } = loadPlanCatalog();
    expect(source).toMatch(/bundled|override/);
    expect(catalog.plans.length).toBeGreaterThanOrEqual(5);
    for (const planId of ["free", "pro", "max5x", "max20x", "api"] as const) {
      const plan = findPlan(catalog, planId);
      expect(plan).not.toBeNull();
      expect(plan!.id).toBe(planId);
    }
  });

  it("findPlan returns null for unset or unknown plan", () => {
    const { catalog } = loadPlanCatalog();
    expect(findPlan(catalog, null)).toBeNull();
    // @ts-expect-error — testing invalid input
    expect(findPlan(catalog, "bogus")).toBeNull();
  });

  it("catalog throttle window covers weekday peak hours", () => {
    const { catalog } = loadPlanCatalog();
    expect(catalog.throttleWindows.length).toBeGreaterThanOrEqual(1);
    const w = catalog.throttleWindows[0];
    expect(w.startHourUtc).toBe(13);
    expect(w.endHourUtc).toBe(19);
    expect(w.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("plan-catalog file integrity", () => {
  it("every plan carries a non-empty label and confidence fields", () => {
    const { catalog } = loadPlanCatalog();
    for (const plan of catalog.plans) {
      expect(plan.label.length).toBeGreaterThan(0);
      expect(["official", "estimate", "unknown"]).toContain(plan.sessionWindow.confidence);
      expect(["official", "estimate", "unknown"]).toContain(plan.weekly.confidence);
    }
  });

  it("API plan is flagged pay-per-token", () => {
    const { catalog } = loadPlanCatalog();
    const api = findPlan(catalog, "api");
    expect(api!.payPerToken).toBe(true);
  });

  it("Max plans have Opus weekly ranges; Pro does not", () => {
    const { catalog } = loadPlanCatalog();
    expect(findPlan(catalog, "pro")!.weekly.opusHoursMin).toBeNull();
    expect(findPlan(catalog, "max5x")!.weekly.opusHoursMin).toBe(15);
    expect(findPlan(catalog, "max20x")!.weekly.opusHoursMin).toBe(24);
  });
});

describe("buildWeeklyBuildup", () => {
  const now = new Date("2026-04-16T14:00:00Z");

  it("returns 7 points covering the last 7 calendar days including today", () => {
    const points = buildWeeklyBuildup([], now);
    expect(points.length).toBe(7);
    // Today is the last one.
    expect(points[points.length - 1].date).toBe("2026-04-16");
    // 6 days ago is the first.
    expect(points[0].date).toBe("2026-04-10");
  });

  it("all cumulative values are zero for empty input", () => {
    const points = buildWeeklyBuildup([], now);
    for (const p of points) {
      expect(p.sonnetHours).toBe(0);
      expect(p.cumSonnetHours).toBe(0);
      expect(p.cumCostUsd).toBe(0);
    }
  });

  it("cumulative running totals are monotonic", () => {
    const turns = [
      turn("2026-04-11T10:00:00Z", 100, "claude-sonnet-4-6", 0.5),
      turn("2026-04-13T12:00:00Z", 200, "claude-sonnet-4-6", 0.8),
      turn("2026-04-16T08:00:00Z", 300, "claude-opus-4-6", 1.2),
    ];
    const points = buildWeeklyBuildup(turns, now);
    // Running sums are non-decreasing.
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumCostUsd).toBeGreaterThanOrEqual(points[i - 1].cumCostUsd);
      expect(points[i].cumSonnetHours).toBeGreaterThanOrEqual(points[i - 1].cumSonnetHours);
      expect(points[i].cumOpusHours).toBeGreaterThanOrEqual(points[i - 1].cumOpusHours);
    }
    // Final cumulative cost equals sum of all per-day costs.
    const perDaySum = points.reduce((s, p) => s + p.costUsd, 0);
    expect(points[6].cumCostUsd).toBeCloseTo(perDaySum, 4);
  });
});

// Sanity check of re-exported function from dashboard-analytics — just ensure the
// dashboard module and plan-usage module both compile together and the types align.
describe("smoke", () => {
  it("computeRangeCutoff(all) returns null", () => {
    expect(computeRangeCutoff("all")).toBeNull();
  });
});

// Helpers shared by the multi-user polish tests below.
function makeLitePlan(id: PlanId, payPerToken = false): PlanDefinition {
  return {
    id,
    label: id,
    priceUsdMonthly: 0,
    priceUsdAnnual: null,
    bestFor: "",
    sessionWindow: { durationHours: 5, tokenLimit: null, confidence: "official" },
    weekly: { sonnetHoursMin: null, sonnetHoursMax: null, opusHoursMin: null, opusHoursMax: null, confidence: "unknown" },
    payPerToken,
  };
}

function makeLimits(overrides: Partial<HistoricalLimits>): HistoricalLimits {
  return {
    hits: [],
    totalHits: 0,
    totalHitsLast30Days: 0,
    medianTokens: null,
    medianHours: null,
    p25Tokens: null,
    p50Tokens: null,
    p90Tokens: null,
    mostRecent: null,
    opusShareAtHitPct: null,
    sampleSize: 0,
    ...overrides,
  };
}

describe("fallbackSessionCeiling()", () => {
  it("returns null ceiling + 'unknown' confidence when no plan is selected", () => {
    const est = fallbackSessionCeiling(null);
    expect(est.tokensPerSession).toBeNull();
    expect(est.confidence).toBe("unknown");
  });

  it("returns null ceiling for pay-per-token (API) plans — no session cap applies", () => {
    const est = fallbackSessionCeiling(makeLitePlan("api", true));
    expect(est.tokensPerSession).toBeNull();
    expect(est.confidence).toBe("unknown");
  });

  it("returns plan-specific estimates ordered by plan richness (Free < Pro < Max 5x < Max 20x)", () => {
    const free = fallbackSessionCeiling(makeLitePlan("free")).tokensPerSession!;
    const pro = fallbackSessionCeiling(makeLitePlan("pro")).tokensPerSession!;
    const max5x = fallbackSessionCeiling(makeLitePlan("max5x")).tokensPerSession!;
    const max20x = fallbackSessionCeiling(makeLitePlan("max20x")).tokensPerSession!;
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(pro);
    expect(pro).toBeLessThan(max5x);
    expect(max5x).toBeLessThan(max20x);
  });

  it("returns 'estimate' confidence whenever the number is non-null", () => {
    const est = fallbackSessionCeiling(makeLitePlan("pro"));
    expect(est.tokensPerSession).not.toBeNull();
    expect(est.confidence).toBe("estimate");
    expect(est.basis.length).toBeGreaterThan(0);
  });
});

describe("detectPlanMismatch()", () => {
  it("returns null when sample size is below the 5-hit threshold", () => {
    expect(detectPlanMismatch(makeLitePlan("pro"), makeLimits({ sampleSize: 4, medianTokens: 3_000_000 }))).toBeNull();
  });

  it("returns null when no plan is selected", () => {
    expect(detectPlanMismatch(null, makeLimits({ sampleSize: 10, medianTokens: 3_000_000 }))).toBeNull();
  });

  it("returns null when the observed band matches the selected plan", () => {
    // Pro band = <700K tokens. Median = 500K → on-plan.
    expect(detectPlanMismatch(makeLitePlan("pro"), makeLimits({ sampleSize: 10, medianTokens: 500_000 }))).toBeNull();
  });

  it("suggests Max 5x when a Pro user's median is in the 700K–5M band", () => {
    const hit = detectPlanMismatch(makeLitePlan("pro"), makeLimits({ sampleSize: 10, medianTokens: 2_000_000 }));
    expect(hit).not.toBeNull();
    expect(hit!.suggestedPlanId).toBe("max5x");
    expect(hit!.reason).toContain("2.0M");
  });

  it("suggests Max 20x when a Pro user's median exceeds 5M tokens", () => {
    const hit = detectPlanMismatch(makeLitePlan("pro"), makeLimits({ sampleSize: 10, medianTokens: 7_500_000 }));
    expect(hit).not.toBeNull();
    expect(hit!.suggestedPlanId).toBe("max20x");
  });

  it("does not downgrade-suggest — Max 20x users with low observed usage get no hint", () => {
    expect(detectPlanMismatch(makeLitePlan("max20x"), makeLimits({ sampleSize: 10, medianTokens: 500_000 }))).toBeNull();
  });

  it("skips pay-per-token plans entirely", () => {
    expect(detectPlanMismatch(makeLitePlan("api", true), makeLimits({ sampleSize: 10, medianTokens: 9_000_000 }))).toBeNull();
  });
});
