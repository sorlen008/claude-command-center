/**
 * Unified model pricing — single source of truth for all cost calculations.
 * Used by: session-analytics, cost-analytics, live-scanner
 */

// USD per million tokens
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "opus":   { input: 15,   output: 75,  cacheRead: 1.5,   cacheCreation: 18.75 },
  "sonnet": { input: 3,    output: 15,  cacheRead: 0.3,   cacheCreation: 3.75 },
  "haiku":  { input: 0.80, output: 4,   cacheRead: 0.08,  cacheCreation: 1 },
};

/** Get pricing for a model by matching family name */
export function getPricing(model: string): ModelPricing {
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key)) return pricing;
  }
  return MODEL_PRICING.sonnet; // default
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
  if (model.includes("opus") && observedTokens > 200_000) return 1_000_000;
  return 200_000;
}
