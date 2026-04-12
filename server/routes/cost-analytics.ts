import { Router } from "express";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { getCachedSessions } from "../scanner/session-scanner";
import { decodeProjectKey } from "../scanner/utils";

const router = Router();

// --- Pricing per million tokens (USD) ---
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  opus:   { input: 15,   output: 75,  cacheRead: 15 * 0.1,   cacheWrite: 15 * 1.25 },
  sonnet: { input: 3,    output: 15,  cacheRead: 3 * 0.1,    cacheWrite: 3 * 1.25 },
  haiku:  { input: 0.80, output: 4,   cacheRead: 0.80 * 0.1, cacheWrite: 0.80 * 1.25 },
};

function getModelFamily(model: string): string {
  const lower = model.toLowerCase();
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lower.includes(key)) return key;
  }
  return "sonnet"; // default
}

function getPricing(model: string) {
  return MODEL_PRICING[getModelFamily(model)] || MODEL_PRICING.sonnet;
}

function computeCost(
  pricing: { input: number; output: number; cacheRead: number; cacheWrite: number },
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (cacheWriteTokens / 1_000_000) * pricing.cacheWrite
  );
}

// --- Error classification ---
function classifyError(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("permission denied") || lower.includes("eacces") || lower.includes("access denied")) return "permission";
  if (lower.includes("enotfound") || lower.includes("econnrefused") || lower.includes("network") || lower.includes("timeout") || lower.includes("fetch failed")) return "network";
  if (lower.includes("compilation") || lower.includes("tsc") || lower.includes("type error") || lower.includes("syntaxerror") || lower.includes("cannot find module")) return "compilation";
  if (lower.includes("test fail") || lower.includes("assertion") || lower.includes("expect(") || lower.includes("test suite failed")) return "test_failure";
  if (lower.includes("tool_use") || lower.includes("tool error") || lower.includes("command failed") || lower.includes("exit code")) return "tool_error";
  return "other";
}

// --- Cache ---
interface CostAnalyticsResult {
  dailyCosts: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
  }>;
  byModel: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    sessions: number;
  }>;
  byProject: Array<{
    project: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    sessions: number;
  }>;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  planLimits: {
    pro: { limit: number; label: string };
    max5x: { limit: number; label: string };
    max20x: { limit: number; label: string };
  };
  errors: Array<{
    type: string;
    count: number;
    lastSeen: string;
    example: string;
  }>;
}

let cachedResult: CostAnalyticsResult | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- JSONL streaming reader ---
async function processSessionFile(filePath: string): Promise<{
  tokens: Array<{
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>;
  errors: Array<{
    timestamp: string;
    text: string;
  }>;
  models: Set<string>;
}> {
  const tokens: Array<{
    timestamp: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }> = [];
  const errors: Array<{ timestamp: string; text: string }> = [];
  const models = new Set<string>();

  return new Promise((resolve) => {
    try {
      const stream = createReadStream(filePath, { encoding: "utf-8" });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on("line", (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const record = JSON.parse(trimmed);

          // Extract token usage from assistant messages
          if (record.type === "assistant" && record.message?.usage) {
            const u = record.message.usage;
            const model = record.message.model || "unknown";
            const inputTk = u.input_tokens || 0;
            const outputTk = u.output_tokens || 0;
            const cacheReadTk = u.cache_read_input_tokens || 0;
            const cacheWriteTk = u.cache_creation_input_tokens || 0;
            models.add(model);
            tokens.push({
              timestamp: record.timestamp || "",
              model,
              inputTokens: inputTk,
              outputTokens: outputTk,
              cacheReadTokens: cacheReadTk,
              cacheWriteTokens: cacheWriteTk,
            });
          }

          // Extract errors from user messages containing tool_result with is_error
          if (record.type === "user" && record.message?.content && Array.isArray(record.message.content)) {
            for (const item of record.message.content) {
              if (item?.type === "tool_result" && item.is_error === true) {
                let errorText = "";
                if (typeof item.content === "string") {
                  errorText = item.content;
                } else if (Array.isArray(item.content)) {
                  errorText = item.content
                    .filter((c: any) => c?.type === "text")
                    .map((c: any) => c.text || "")
                    .join(" ");
                }
                if (errorText) {
                  errors.push({
                    timestamp: record.timestamp || "",
                    text: errorText.slice(0, 500),
                  });
                }
              }
            }
          }
        } catch {
          // malformed JSON line — skip
        }
      });

      rl.on("close", () => resolve({ tokens, errors, models }));
      rl.on("error", () => resolve({ tokens, errors, models }));
      stream.on("error", () => {
        rl.close();
        resolve({ tokens, errors, models });
      });
    } catch {
      resolve({ tokens, errors, models });
    }
  });
}

async function buildCostAnalytics(): Promise<CostAnalyticsResult> {
  const sessions = getCachedSessions();

  // Date cutoff: 30 days ago
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  // Initialize daily buckets for last 30 days
  const dailyMap: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
  }> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    dailyMap[dateKey] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 };
  }

  // Per-model aggregates
  const modelMap: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    sessionSet: Set<string>;
  }> = {};

  // Per-project aggregates
  const projectMap: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    sessionSet: Set<string>;
  }> = {};

  // Totals
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;

  // Error aggregation
  const errorTypeMap: Record<string, {
    count: number;
    lastSeen: string;
    example: string;
  }> = {};

  // Process sessions in parallel batches to avoid overwhelming the filesystem
  const BATCH_SIZE = 20;
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (session) => {
        const result = await processSessionFile(session.filePath);
        return { session, result };
      })
    );

    for (const { session, result } of results) {
      const projectPath = decodeProjectKey(session.projectKey);

      // Determine model families seen in this session for model-level session counting
      const modelFamiliesSeen = new Set<string>();

      for (const tk of result.tokens) {
        const family = getModelFamily(tk.model);
        const pricing = getPricing(tk.model);
        const cost = computeCost(pricing, tk.inputTokens, tk.outputTokens, tk.cacheReadTokens, tk.cacheWriteTokens);

        // Totals (all time within files)
        totalInputTokens += tk.inputTokens;
        totalOutputTokens += tk.outputTokens;
        totalCacheReadTokens += tk.cacheReadTokens;
        totalCacheWriteTokens += tk.cacheWriteTokens;
        totalCost += cost;

        // Daily (only last 30 days)
        const dateKey = tk.timestamp.slice(0, 10);
        if (dateKey >= cutoffStr && dailyMap[dateKey]) {
          dailyMap[dateKey].inputTokens += tk.inputTokens;
          dailyMap[dateKey].outputTokens += tk.outputTokens;
          dailyMap[dateKey].cacheReadTokens += tk.cacheReadTokens;
          dailyMap[dateKey].cacheWriteTokens += tk.cacheWriteTokens;
          dailyMap[dateKey].cost += cost;
        }

        // Per-model
        if (!modelMap[family]) {
          modelMap[family] = { inputTokens: 0, outputTokens: 0, cost: 0, sessionSet: new Set() };
        }
        modelMap[family].inputTokens += tk.inputTokens;
        modelMap[family].outputTokens += tk.outputTokens;
        modelMap[family].cost += cost;
        modelFamiliesSeen.add(family);

        // Per-project
        if (!projectMap[projectPath]) {
          projectMap[projectPath] = { inputTokens: 0, outputTokens: 0, cost: 0, sessionSet: new Set() };
        }
        projectMap[projectPath].inputTokens += tk.inputTokens;
        projectMap[projectPath].outputTokens += tk.outputTokens;
        projectMap[projectPath].cost += cost;
      }

      // Count session once per model family
      Array.from(modelFamiliesSeen).forEach((family) => {
        modelMap[family].sessionSet.add(session.id);
      });

      // Count session once per project (if it had any tokens)
      if (result.tokens.length > 0) {
        projectMap[projectPath].sessionSet.add(session.id);
      }

      // Aggregate errors
      for (const err of result.errors) {
        const errType = classifyError(err.text);
        if (!errorTypeMap[errType]) {
          errorTypeMap[errType] = { count: 0, lastSeen: "", example: "" };
        }
        errorTypeMap[errType].count++;
        if (!errorTypeMap[errType].lastSeen || err.timestamp > errorTypeMap[errType].lastSeen) {
          errorTypeMap[errType].lastSeen = err.timestamp;
          errorTypeMap[errType].example = err.text.slice(0, 300);
        }
      }
    }
  }

  // Build daily costs array sorted by date
  const dailyCosts = Object.entries(dailyMap)
    .map(([date, data]) => ({ date, ...data, cost: Math.round(data.cost * 1000) / 1000 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Build byModel (convert sessionSet to count)
  const byModel: CostAnalyticsResult["byModel"] = {};
  for (const [family, data] of Object.entries(modelMap)) {
    byModel[family] = {
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cost: Math.round(data.cost * 1000) / 1000,
      sessions: data.sessionSet.size,
    };
  }

  // Build byProject sorted by cost descending
  const byProject = Object.entries(projectMap)
    .map(([project, data]) => ({
      project,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cost: Math.round(data.cost * 1000) / 1000,
      sessions: data.sessionSet.size,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Build errors array sorted by count descending
  const errors = Object.entries(errorTypeMap)
    .map(([type, data]) => ({
      type,
      count: data.count,
      lastSeen: data.lastSeen,
      example: data.example,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    dailyCosts,
    byModel,
    byProject,
    totalCost: Math.round(totalCost * 1000) / 1000,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    planLimits: {
      pro: { limit: 0, label: "Pro (usage-based)" },
      max5x: { limit: 100, label: "Max $100/mo" },
      max20x: { limit: 200, label: "Max $200/mo" },
    },
    errors,
  };
}

// --- Route handlers ---
router.get("/api/analytics/costs", async (_req, res) => {
  try {
    const now = Date.now();
    if (cachedResult && (now - cacheTimestamp) < CACHE_TTL_MS) {
      return res.json(cachedResult);
    }

    const result = await buildCostAnalytics();
    cachedResult = result;
    cacheTimestamp = Date.now();
    res.json(result);
  } catch (err) {
    console.error("[cost-analytics] Failed to build analytics:", (err as Error).message);
    res.status(500).json({ message: "Failed to build cost analytics", error: (err as Error).message });
  }
});

/** GET /api/analytics/insights — Cost optimization suggestions, anomaly detection, budget alerts */
router.get("/api/analytics/insights", async (_req, res) => {
  try {
    const { generateInsights } = await import("../scanner/insights");
    // Get cost data (use cache if available)
    const now = Date.now();
    if (!cachedResult || (now - cacheTimestamp) >= CACHE_TTL_MS) {
      cachedResult = await buildCostAnalytics();
      cacheTimestamp = now;
    }
    const insights = generateInsights(cachedResult);
    res.json({ insights });
  } catch (err) {
    console.error("[insights] Failed:", (err as Error).message);
    res.status(500).json({ message: "Failed to generate insights" });
  }
});

export default router;
