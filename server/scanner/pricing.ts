/**
 * Unified model pricing — single source of truth for all cost calculations.
 * Used by: session-analytics, cost-analytics, burn-analytics, dashboard-analytics, plan-usage
 *
 * Verified against https://claude.com/pricing on 2026-04-15.
 * Legacy rates kept so historical session replay stays accurate.
 */

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

// Regex-matched in order. First match wins.
const MODEL_RATE_TABLE: Array<{ match: RegExp; pricing: ModelPricing; note: string }> = [
  // Opus 4.5 and up (4.5, 4.6, 4.7, 4.8, … incl. two-digit minors) — current
  // reduced pricing. MUST precede the 4.0/4.1 legacy row, whose \b would
  // otherwise also match "opus-4-7"/"opus-4-8" and overcharge them 3×.
  { match: /opus-4-(?:[5-9]|[1-9]\d)/i, pricing: { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 }, note: "opus-4.5+" },
  // Opus 4.0 / 4.1 — legacy, original Claude 4 pricing
  { match: /opus-4(?:-[01])?\b/i, pricing: { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 }, note: "opus-4.0/4.1 legacy" },
  // Opus 3 — legacy
  { match: /opus-3/i, pricing: { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 }, note: "opus-3 legacy" },
  // Opus catch-all (unknown version) — use current rates as reasonable default
  { match: /opus/i, pricing: { input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 }, note: "opus default" },

  // Sonnet 4 / 4.5 / 4.6 — stable pricing across the family
  { match: /sonnet/i, pricing: { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 }, note: "sonnet" },

  // Haiku 4.5 — current
  { match: /haiku-4/i, pricing: { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 }, note: "haiku-4.5" },
  // Haiku 3.5 — legacy
  { match: /haiku-3-5|haiku-3\.5/i, pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 }, note: "haiku-3.5 legacy" },
  // Haiku 3 — legacy
  { match: /haiku-3/i, pricing: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheCreation: 0.3 }, note: "haiku-3 legacy" },
  // Haiku catch-all — use current rates
  { match: /haiku/i, pricing: { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 }, note: "haiku default" },
];

const SONNET_FALLBACK: ModelPricing = { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 };

/** Get pricing for a model by version-aware matching. Falls back to Sonnet rates for unknown models. */
export function getPricing(model: string): ModelPricing {
  for (const row of MODEL_RATE_TABLE) {
    if (row.match.test(model)) return row.pricing;
  }
  return SONNET_FALLBACK;
}

/** Calculate cost in USD from token counts */
export function computeCost(
  pricing: ModelPricing,
  input: number,
  output: number,
  cacheRead = 0,
  cacheCreation = 0,
): number {
  return (
    (input * pricing.input) +
    (output * pricing.output) +
    (cacheRead * pricing.cacheRead) +
    (cacheCreation * pricing.cacheCreation)
  ) / 1_000_000;
}

/**
 * Max context window by model family.
 * Opus 4.6 has a 1M-token beta (header `context-1m-2025-08-07`) but the JSONL
 * doesn't record which header was used, so we default Opus to 200K and only
 * promote to 1M once observed usage proves the larger window is in effect.
 */
export function getMaxTokens(model: string, observedTokens = 0): number {
  if (/opus/i.test(model) && observedTokens > 200_000) return 1_000_000;
  return 200_000;
}

/**
 * Fraction of the raw context window that Claude Code's terminal meter treats as
 * usable. It reserves the remainder for model output and the auto-compact buffer,
 * so the terminal % is measured against this budget, not the full window.
 *
 * Empirically calibrated against two observed Claude Code terminal readings:
 *   - 1M Opus beta: 276,718 tokens shown as ~35% → ~790K usable (≈0.79 × 1M).
 *   - 200K window:  162,157 tokens shown as ~81% → the FULL 200K (no reserve).
 * So the reserve applies to the 1M beta (which holds back more headroom for
 * output + auto-compaction), while the standard 200K window is measured against
 * the whole window. Derived from observed behaviour / third-party analysis, NOT
 * official docs — may drift across Claude Code versions; a single tunable knob.
 */
export const USABLE_CONTEXT_FRACTION = 0.79;

/** Usable context budget the terminal % is measured against (see USABLE_CONTEXT_FRACTION). */
export function getUsableContext(model: string, observedTokens = 0): number {
  const window = getMaxTokens(model, observedTokens);
  // Only the 1M beta reserves a large share; the 200K window uses the full window.
  return window >= 1_000_000 ? Math.round(window * USABLE_CONTEXT_FRACTION) : window;
}
