import fs from "fs";
import type {
  SessionData, SessionCostData, CostAnalytics,
  FileHeatmapEntry, FileHeatmapResult,
  SessionHealth, HealthAnalytics, StaleAnalytics,
} from "@shared/types";

// Model pricing: USD per million tokens
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number }> = {
  "claude-opus-4-6":   { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  "claude-opus-4-5":   { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  "claude-haiku-4-5":  { input: 0.80, output: 4, cacheRead: 0.08, cacheCreation: 1 },
};

function getPricing(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Fallback: match by substring
  if (model.includes("opus")) return MODEL_PRICING["claude-opus-4-6"];
  if (model.includes("sonnet")) return MODEL_PRICING["claude-sonnet-4-6"];
  if (model.includes("haiku")) return MODEL_PRICING["claude-haiku-4-5"];
  return MODEL_PRICING["claude-sonnet-4-6"]; // default
}

function calcCost(pricing: ReturnType<typeof getPricing>, input: number, output: number, cacheRead: number, cacheCreation: number): number {
  return (
    (input * pricing.input) +
    (output * pricing.output) +
    (cacheRead * pricing.cacheRead) +
    (cacheCreation * pricing.cacheCreation)
  ) / 1_000_000;
}

interface RawAnalytics {
  cost: SessionCostData;
  files: Map<string, { read: number; write: number; edit: number; lastTs: string; sessions: Set<string> }>;
  health: SessionHealth;
}

/** Scan a single session JSONL for cost, file ops, and health data */
function analyzeSession(session: SessionData): RawAnalytics | null {
  const modelBreakdown: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number; cost: number }> = {};
  const modelsSet = new Set<string>();
  const fileOps = new Map<string, { read: number; write: number; edit: number; lastTs: string }>();
  let toolErrors = 0;
  let retries = 0;
  let totalToolCalls = 0;
  let lastEditFile = "";
  let lastEditTs = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;

  try {
    const content = fs.readFileSync(session.filePath, "utf-8");
    let pos = 0;

    while (pos < content.length) {
      const nextNewline = content.indexOf("\n", pos);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const trimmed = content.slice(pos, lineEnd).trim();
      pos = lineEnd + 1;
      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed);
        const ts = record.timestamp || "";

        if (record.type === "assistant") {
          const msg = record.message;
          if (!msg || typeof msg !== "object") continue;

          // Token usage
          const usage = msg.usage;
          if (usage) {
            const model = msg.model || "unknown";
            modelsSet.add(model);
            const inp = usage.input_tokens || 0;
            const out = usage.output_tokens || 0;
            const cr = usage.cache_read_input_tokens || 0;
            const cc = usage.cache_creation_input_tokens || 0;

            totalInput += inp;
            totalOutput += out;
            totalCacheRead += cr;
            totalCacheCreation += cc;

            if (!modelBreakdown[model]) {
              modelBreakdown[model] = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0 };
            }
            modelBreakdown[model].input += inp;
            modelBreakdown[model].output += out;
            modelBreakdown[model].cacheRead += cr;
            modelBreakdown[model].cacheCreation += cc;
          }

          // Tool use blocks — extract file paths and tool names
          const msgContent = msg.content;
          if (Array.isArray(msgContent)) {
            for (const item of msgContent) {
              if (item == null || typeof item !== "object") continue;
              if (item.type === "tool_use") {
                totalToolCalls++;
                const toolName = (item.name || "").toLowerCase();
                const input = item.input as Record<string, unknown> | undefined;
                if (input) {
                  const fp = (input.file_path || input.path || "") as string;
                  if (fp && (toolName === "read" || toolName === "write" || toolName === "edit" || toolName === "glob")) {
                    const existing = fileOps.get(fp) || { read: 0, write: 0, edit: 0, lastTs: "" };
                    if (toolName === "read") existing.read++;
                    else if (toolName === "write") existing.write++;
                    else if (toolName === "edit") existing.edit++;
                    if (ts > existing.lastTs) existing.lastTs = ts;
                    fileOps.set(fp, existing);

                    // Detect retries: same file edited within 60 seconds
                    if (toolName === "edit" || toolName === "write") {
                      const now = new Date(ts).getTime();
                      if (fp === lastEditFile && now - lastEditTs < 60000) {
                        retries++;
                      }
                      lastEditFile = fp;
                      lastEditTs = now;
                    }
                  }
                }
              }
            }
          }
        } else if (record.type === "user") {
          // Check for tool_result errors
          const msg = record.message;
          if (!msg || typeof msg !== "object") continue;
          const msgContent = msg.content;
          if (Array.isArray(msgContent)) {
            for (const item of msgContent) {
              if (item == null || typeof item !== "object") continue;
              if (item.type === "tool_result" && item.is_error) {
                toolErrors++;
              }
            }
          }
        }
      } catch {
        // Malformed line
      }
    }
  } catch {
    return null;
  }

  // Calculate costs per model
  let totalCost = 0;
  for (const [model, data] of Object.entries(modelBreakdown)) {
    const pricing = getPricing(model);
    data.cost = calcCost(pricing, data.input, data.output, data.cacheRead, data.cacheCreation);
    totalCost += data.cost;
  }

  // Health score
  let healthScore: "good" | "fair" | "poor" = "good";
  if (toolErrors > 10 || retries > 8) healthScore = "poor";
  else if (toolErrors > 3 || retries > 3) healthScore = "fair";

  // Build file map with session ID
  const filesWithSession = new Map<string, { read: number; write: number; edit: number; lastTs: string; sessions: Set<string> }>();
  fileOps.forEach((ops, fp) => {
    filesWithSession.set(fp, { ...ops, sessions: new Set([session.id]) });
  });

  return {
    cost: {
      sessionId: session.id,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheCreationTokens: totalCacheCreation,
      estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
      models: Array.from(modelsSet),
      modelBreakdown,
    },
    files: filesWithSession,
    health: {
      sessionId: session.id,
      toolErrors,
      retries,
      totalToolCalls,
      healthScore,
    },
  };
}

// Cache
let cachedCostAnalytics: CostAnalytics | null = null;
let cachedFileHeatmap: FileHeatmapResult | null = null;
let cachedHealthAnalytics: HealthAnalytics | null = null;
let cachedSessionCosts: Map<string, SessionCostData> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

function isCacheValid(): boolean {
  return Date.now() - cacheTimestamp < CACHE_TTL;
}

function runFullScan(sessions: SessionData[]): void {
  const start = performance.now();
  const nonEmpty = sessions.filter(s => !s.isEmpty && s.messageCount > 0);

  const allCosts: SessionCostData[] = [];
  const globalFiles = new Map<string, { read: number; write: number; edit: number; lastTs: string; sessions: Set<string> }>();
  const allHealth: SessionHealth[] = [];
  const costMap = new Map<string, SessionCostData>();

  // Project breakdown
  const byProject: Record<string, { cost: number; sessions: number; tokens: number }> = {};
  const byDay: Record<string, { cost: number; sessions: number; tokens: number }> = {};
  const byModel: Record<string, { cost: number; tokens: number; sessions: number }> = {};

  for (const session of nonEmpty) {
    const result = analyzeSession(session);
    if (!result) continue;

    allCosts.push(result.cost);
    costMap.set(session.id, result.cost);
    allHealth.push(result.health);

    // Merge file ops
    result.files.forEach((ops, fp) => {
      const existing = globalFiles.get(fp);
      if (existing) {
        existing.read += ops.read;
        existing.write += ops.write;
        existing.edit += ops.edit;
        if (ops.lastTs > existing.lastTs) existing.lastTs = ops.lastTs;
        Array.from(ops.sessions).forEach(sid => existing.sessions.add(sid));
      } else {
        globalFiles.set(fp, { ...ops, sessions: new Set(Array.from(ops.sessions)) });
      }
    });

    // Aggregate by project
    const proj = session.projectKey || "unknown";
    if (!byProject[proj]) byProject[proj] = { cost: 0, sessions: 0, tokens: 0 };
    byProject[proj].cost += result.cost.estimatedCostUsd;
    byProject[proj].sessions++;
    byProject[proj].tokens += result.cost.inputTokens + result.cost.outputTokens;

    // Aggregate by day
    const day = (session.firstTs || "").slice(0, 10);
    if (day) {
      if (!byDay[day]) byDay[day] = { cost: 0, sessions: 0, tokens: 0 };
      byDay[day].cost += result.cost.estimatedCostUsd;
      byDay[day].sessions++;
      byDay[day].tokens += result.cost.inputTokens + result.cost.outputTokens;
    }

    // Aggregate by model
    for (const [model, data] of Object.entries(result.cost.modelBreakdown)) {
      if (!byModel[model]) byModel[model] = { cost: 0, tokens: 0, sessions: 0 };
      byModel[model].cost += data.cost;
      byModel[model].tokens += data.input + data.output;
      byModel[model].sessions++;
    }
  }

  const durationMs = Math.round(performance.now() - start);

  // Build cost analytics
  const totalCost = allCosts.reduce((s, c) => s + c.estimatedCostUsd, 0);
  const totalInput = allCosts.reduce((s, c) => s + c.inputTokens, 0);
  const totalOutput = allCosts.reduce((s, c) => s + c.outputTokens, 0);

  const topSessions = allCosts
    .filter(c => c.estimatedCostUsd > 0)
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
    .slice(0, 20)
    .map(c => {
      const sess = sessions.find(s => s.id === c.sessionId);
      return {
        sessionId: c.sessionId,
        firstMessage: (sess?.firstMessage || "").slice(0, 100),
        cost: Math.round(c.estimatedCostUsd * 10000) / 10000,
        tokens: c.inputTokens + c.outputTokens,
      };
    });

  const byDayArr = Object.entries(byDay)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Round costs
  for (const key of Object.keys(byProject)) {
    byProject[key].cost = Math.round(byProject[key].cost * 10000) / 10000;
  }
  for (const key of Object.keys(byModel)) {
    byModel[key].cost = Math.round(byModel[key].cost * 10000) / 10000;
  }
  for (const d of byDayArr) {
    d.cost = Math.round(d.cost * 10000) / 10000;
  }

  cachedCostAnalytics = {
    totalCostUsd: Math.round(totalCost * 10000) / 10000,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalSessions: nonEmpty.length,
    byProject,
    byDay: byDayArr,
    byModel,
    topSessions,
    durationMs,
  };

  // Build file heatmap
  const fileEntries: FileHeatmapEntry[] = [];
  let totalOps = 0;
  globalFiles.forEach((ops, fp) => {
    const parts = fp.replace(/\\/g, "/").split("/");
    const total = ops.read + ops.write + ops.edit;
    totalOps += total;
    fileEntries.push({
      filePath: fp,
      fileName: parts[parts.length - 1] || fp,
      touchCount: total,
      sessionCount: ops.sessions.size,
      operations: { read: ops.read, write: ops.write, edit: ops.edit },
      lastTouched: ops.lastTs,
      sessions: Array.from(ops.sessions),
    });
  });
  fileEntries.sort((a, b) => b.touchCount - a.touchCount);

  cachedFileHeatmap = {
    files: fileEntries.slice(0, 100),
    totalFiles: fileEntries.length,
    totalOperations: totalOps,
    durationMs,
  };

  // Build health analytics
  let poorCount = 0, fairCount = 0, goodCount = 0;
  let totalErrors = 0, totalRetries = 0;
  for (const h of allHealth) {
    if (h.healthScore === "poor") poorCount++;
    else if (h.healthScore === "fair") fairCount++;
    else goodCount++;
    totalErrors += h.toolErrors;
    totalRetries += h.retries;
  }

  cachedHealthAnalytics = {
    sessions: allHealth.filter(h => h.healthScore !== "good").sort((a, b) => b.toolErrors - a.toolErrors).slice(0, 50),
    avgToolErrors: allHealth.length ? Math.round(totalErrors / allHealth.length * 10) / 10 : 0,
    avgRetries: allHealth.length ? Math.round(totalRetries / allHealth.length * 10) / 10 : 0,
    poorCount,
    fairCount,
    goodCount,
    durationMs,
  };

  cachedSessionCosts = costMap;
  cacheTimestamp = Date.now();
}

export function getCostAnalytics(sessions: SessionData[]): CostAnalytics {
  if (!isCacheValid()) runFullScan(sessions);
  return cachedCostAnalytics!;
}

export function getFileHeatmap(sessions: SessionData[]): FileHeatmapResult {
  if (!isCacheValid()) runFullScan(sessions);
  return cachedFileHeatmap!;
}

export function getHealthAnalytics(sessions: SessionData[]): HealthAnalytics {
  if (!isCacheValid()) runFullScan(sessions);
  return cachedHealthAnalytics!;
}

export function getSessionCost(sessions: SessionData[], sessionId: string): SessionCostData | null {
  if (!isCacheValid()) runFullScan(sessions);
  return cachedSessionCosts.get(sessionId) || null;
}

export function getStaleAnalytics(sessions: SessionData[]): StaleAnalytics {
  const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const empty = sessions.filter(s => s.isEmpty).map(s => ({ id: s.id, sizeBytes: s.sizeBytes }));
  const stale = sessions
    .filter(s => !s.isEmpty && s.messageCount < 5 && (s.lastTs || "") < THIRTY_DAYS_AGO)
    .map(s => ({
      id: s.id,
      firstMessage: (s.firstMessage || "").slice(0, 100),
      lastTs: s.lastTs || "",
      messageCount: s.messageCount,
      sizeBytes: s.sizeBytes,
    }));

  const reclaimableBytes = empty.reduce((s, e) => s + e.sizeBytes, 0) +
    stale.reduce((s, e) => s + e.sizeBytes, 0);

  return {
    stale,
    empty,
    totalStale: stale.length,
    totalEmpty: empty.length,
    reclaimableBytes,
  };
}
