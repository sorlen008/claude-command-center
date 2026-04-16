import { getPricing, computeCost } from "./pricing";
import { extractTurns, type RawTurn, type RawToolUse, type RawErrorEvent } from "./turn-extractor";

// Categories the classifier can assign to a single assistant turn.
export type BurnCategory =
  | "Coding"
  | "Testing"
  | "Git Ops"
  | "Build"
  | "Delegation"
  | "Planning"
  | "Exploration"
  | "Conversation"
  | "General";

export const BURN_CATEGORIES: BurnCategory[] = [
  "Coding",
  "Testing",
  "Git Ops",
  "Build",
  "Delegation",
  "Planning",
  "Exploration",
  "Conversation",
  "General",
];

export type BurnReason = "none" | "repeat_edit" | "error_after" | "repeat_test";

export interface BurnTurn {
  ts: string;
  model: string;
  category: BurnCategory;
  tokens: number;
  cost: number;
  editedFiles: string[];
  burned: boolean;
  reason: BurnReason;
}

export interface BurnSessionAnalysis {
  sessionId: string;
  turns: BurnTurn[];
  totalTurns: number;
  totalTokens: number;
  totalCost: number;
  burnedTurns: number;
  burnedTokens: number;
  burnedCost: number;
  firstTs: string | null;
  lastTs: string | null;
}

// Windows for retry-loop attribution. All in ms.
// Same file re-edited inside this window -> the later edit is "burned".
const REPEAT_EDIT_MS = 3 * 60 * 1000;
// Same Bash test command re-run inside this window -> burned.
const REPEAT_TEST_MS = 3 * 60 * 1000;
// Coding turn following a tool_result.is_error inside this window -> burned.
const ERROR_FOLLOWUP_MS = 3 * 60 * 1000;

const TEST_CMD_REGEX = /\b(vitest|pytest|jest|mocha|go test|cargo test|npm (run )?test|pnpm (run )?test|yarn test)\b/i;
const GIT_CMD_REGEX = /\bgit (push|commit|merge|rebase|pull)\b|\bgh (pr|release) (create|edit|merge)\b/i;
const BUILD_CMD_REGEX = /\b(npm run build|pnpm build|yarn build|tsc --noEmit|tsc\s|docker (compose|build|run|up)|pm2 |deploy)\b/i;

export function classifyTurn(toolUses: RawToolUse[]): BurnCategory {
  if (toolUses.length === 0) return "Conversation";

  const names = toolUses.map(t => (t.name || "").toLowerCase());
  const hasEdit = names.some(n => n === "edit" || n === "write" || n === "multiedit" || n === "notebookedit");
  const hasBash = names.some(n => n === "bash");
  const hasAgent = names.some(n => n === "task" || n === "agent");
  const hasPlan = names.some(n => n === "enterplanmode" || n === "exitplanmode");
  const hasRead = names.some(n => n === "read" || n === "grep" || n === "glob" || n === "websearch" || n === "webfetch" || n === "ls");

  if (hasBash) {
    for (const t of toolUses) {
      if ((t.name || "").toLowerCase() !== "bash") continue;
      const cmd = String(t.input?.command || "");
      if (TEST_CMD_REGEX.test(cmd)) return "Testing";
      if (GIT_CMD_REGEX.test(cmd)) return "Git Ops";
      if (BUILD_CMD_REGEX.test(cmd)) return "Build";
    }
  }

  if (hasEdit) return "Coding";
  if (hasAgent) return "Delegation";
  if (hasPlan) return "Planning";
  if (hasRead && !hasEdit && !hasBash) return "Exploration";
  if (hasBash) return "General";
  return "General";
}

function extractEditedFiles(toolUses: RawToolUse[]): string[] {
  const files: string[] = [];
  for (const t of toolUses) {
    const name = (t.name || "").toLowerCase();
    if (name !== "edit" && name !== "write" && name !== "multiedit") continue;
    const fp = String(t.input?.file_path || t.input?.path || "").trim();
    if (fp) files.push(fp);
  }
  return files;
}

function extractBashCmdKey(toolUses: RawToolUse[]): string | null {
  for (const t of toolUses) {
    if ((t.name || "").toLowerCase() !== "bash") continue;
    const cmd = String(t.input?.command || "").trim().toLowerCase();
    if (!cmd) continue;
    // Key by runner binary only so `vitest run tests/foo.ts` and `vitest run tests/bar.ts` collapse.
    const leading = cmd.match(/^(npm|pnpm|yarn)\s+(run\s+)?(\S+)/);
    if (leading) return `${leading[1]} ${leading[3]}`;
    const firstWord = cmd.split(/\s+/)[0] || "";
    return firstWord.slice(0, 20);
  }
  return null;
}

function toMs(ts: string): number {
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

/** Pure analyzer: takes prerecorded raw turns/errors and returns per-turn burn attribution. */
export function buildBurnTurns(turns: RawTurn[], errors: RawErrorEvent[]): BurnTurn[] {
  const result: BurnTurn[] = [];
  const lastEditAtByFile = new Map<string, number>();
  const lastTestCmdAt = new Map<string, number>();
  // Sort errors ascending so we can scan forward.
  const sortedErrorMs = errors.map(e => toMs(e.ts)).filter(n => n > 0).sort((a, b) => a - b);

  for (const turn of turns) {
    const category = classifyTurn(turn.toolUses);
    const editedFiles = extractEditedFiles(turn.toolUses);
    const cmdKey = extractBashCmdKey(turn.toolUses);
    const nowMs = toMs(turn.ts);

    // Tokens counted for burn ratio: active work only (cache reads are ~free and not user-visible work).
    const tokens = turn.inputTokens + turn.outputTokens + turn.cacheCreationTokens;
    const pricing = getPricing(turn.model);
    const cost = computeCost(pricing, turn.inputTokens, turn.outputTokens, turn.cacheReadTokens, turn.cacheCreationTokens);

    let burned = false;
    let reason: BurnReason = "none";

    if (category === "Coding") {
      for (const fp of editedFiles) {
        const prev = lastEditAtByFile.get(fp);
        if (prev !== undefined && nowMs - prev <= REPEAT_EDIT_MS) {
          burned = true;
          reason = "repeat_edit";
          break;
        }
      }
      if (!burned && nowMs > 0) {
        // Any tool_result.is_error in the last ERROR_FOLLOWUP_MS preceding this turn?
        for (let i = sortedErrorMs.length - 1; i >= 0; i--) {
          const errMs = sortedErrorMs[i];
          if (errMs > nowMs) continue;
          if (nowMs - errMs <= ERROR_FOLLOWUP_MS) {
            burned = true;
            reason = "error_after";
          }
          break;
        }
      }
    } else if (category === "Testing") {
      if (cmdKey) {
        const prev = lastTestCmdAt.get(cmdKey);
        if (prev !== undefined && nowMs - prev <= REPEAT_TEST_MS) {
          burned = true;
          reason = "repeat_test";
        }
      }
    }

    // Update trackers AFTER classification so the current turn compares against only earlier turns.
    for (const fp of editedFiles) {
      lastEditAtByFile.set(fp, nowMs);
    }
    if (category === "Testing" && cmdKey) {
      lastTestCmdAt.set(cmdKey, nowMs);
    }

    result.push({
      ts: turn.ts,
      model: turn.model,
      category,
      tokens,
      cost,
      editedFiles,
      burned,
      reason,
    });
  }

  return result;
}

export async function analyzeBurnForFile(sessionId: string, filePath: string): Promise<BurnSessionAnalysis> {
  const { turns, errors } = await extractTurns(filePath);
  const burnTurns = buildBurnTurns(turns, errors);
  let totalTokens = 0, totalCost = 0, burnedTokens = 0, burnedCost = 0;
  let firstTs: string | null = null, lastTs: string | null = null;
  for (const t of burnTurns) {
    totalTokens += t.tokens;
    totalCost += t.cost;
    if (t.burned) {
      burnedTokens += t.tokens;
      burnedCost += t.cost;
    }
    if (t.ts) {
      if (!firstTs || t.ts < firstTs) firstTs = t.ts;
      if (!lastTs || t.ts > lastTs) lastTs = t.ts;
    }
  }
  return {
    sessionId,
    turns: burnTurns,
    totalTurns: burnTurns.length,
    totalTokens,
    totalCost,
    burnedTurns: burnTurns.filter(t => t.burned).length,
    burnedTokens,
    burnedCost,
    firstTs,
    lastTs,
  };
}

// ---- Aggregation ----

export interface BurnCategoryStat {
  category: BurnCategory;
  turns: number;
  tokens: number;
  cost: number;
  burnedTurns: number;
  burnedTokens: number;
  burnedCost: number;
  oneShotRatePct: number;
}

export interface BurnDayStat {
  date: string;
  totalTokens: number;
  burnedTokens: number;
  totalCost: number;
  burnedCost: number;
}

export interface BurnTopSession {
  sessionId: string;
  firstMessage: string;
  turns: number;
  burnedTurns: number;
  burnedTokens: number;
  burnedCost: number;
}

export interface BurnAnalytics {
  totalSessions: number;
  totalTurns: number;
  totalTokens: number;
  totalCost: number;
  burnedTurns: number;
  burnedTokens: number;
  burnedCost: number;
  burnPct: number;
  oneShotRatePct: number;
  worstCategory: BurnCategory | null;
  byCategory: BurnCategoryStat[];
  byDay: BurnDayStat[];
  topBurnSessions: BurnTopSession[];
  durationMs: number;
}

export interface SessionMetaForBurn {
  id: string;
  filePath: string;
  firstMessage?: string;
}

export async function buildBurnAnalytics(sessions: SessionMetaForBurn[]): Promise<BurnAnalytics> {
  const start = performance.now();

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const dailyMap: Record<string, BurnDayStat> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { date: key, totalTokens: 0, burnedTokens: 0, totalCost: 0, burnedCost: 0 };
  }

  const catMap = new Map<BurnCategory, BurnCategoryStat>();
  for (const c of BURN_CATEGORIES) {
    catMap.set(c, { category: c, turns: 0, tokens: 0, cost: 0, burnedTurns: 0, burnedTokens: 0, burnedCost: 0, oneShotRatePct: 100 });
  }

  const perSession: Array<{ id: string; firstMessage: string; analysis: BurnSessionAnalysis }> = [];

  let totalTurns = 0, totalTokens = 0, totalCost = 0;
  let burnedTurns = 0, burnedTokens = 0, burnedCost = 0;

  const BATCH_SIZE = 20;
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(s => analyzeBurnForFile(s.id, s.filePath)));
    for (let k = 0; k < results.length; k++) {
      const a = results[k];
      const meta = batch[k];
      if (a.totalTurns === 0) continue;
      perSession.push({ id: meta.id, firstMessage: (meta.firstMessage || "").slice(0, 120), analysis: a });

      totalTurns += a.totalTurns;
      totalTokens += a.totalTokens;
      totalCost += a.totalCost;
      burnedTurns += a.burnedTurns;
      burnedTokens += a.burnedTokens;
      burnedCost += a.burnedCost;

      for (const t of a.turns) {
        const stat = catMap.get(t.category)!;
        stat.turns++;
        stat.tokens += t.tokens;
        stat.cost += t.cost;
        if (t.burned) {
          stat.burnedTurns++;
          stat.burnedTokens += t.tokens;
          stat.burnedCost += t.cost;
        }
        const dateKey = t.ts.slice(0, 10);
        if (dateKey >= cutoffStr && dailyMap[dateKey]) {
          dailyMap[dateKey].totalTokens += t.tokens;
          dailyMap[dateKey].totalCost += t.cost;
          if (t.burned) {
            dailyMap[dateKey].burnedTokens += t.tokens;
            dailyMap[dateKey].burnedCost += t.cost;
          }
        }
      }
    }
  }

  const catStats = Array.from(catMap.values());
  for (const stat of catStats) {
    stat.oneShotRatePct = stat.turns === 0 ? 100 : Math.round(((stat.turns - stat.burnedTurns) / stat.turns) * 1000) / 10;
    stat.cost = Math.round(stat.cost * 10000) / 10000;
    stat.burnedCost = Math.round(stat.burnedCost * 10000) / 10000;
  }

  // Worst category = highest burn ratio among categories with at least 3 turns.
  let worst: BurnCategory | null = null;
  let worstRatio = -1;
  for (const stat of catStats) {
    if (stat.turns < 3) continue;
    const ratio = stat.burnedTokens / Math.max(stat.tokens, 1);
    if (ratio > worstRatio && stat.burnedTurns > 0) {
      worstRatio = ratio;
      worst = stat.category;
    }
  }

  const byCategory = catStats.slice().sort((a, b) => b.burnedTokens - a.burnedTokens || b.tokens - a.tokens);

  const byDay = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      totalCost: Math.round(d.totalCost * 10000) / 10000,
      burnedCost: Math.round(d.burnedCost * 10000) / 10000,
    }));

  const topBurnSessions: BurnTopSession[] = perSession
    .filter(s => s.analysis.burnedTokens > 0)
    .sort((a, b) => b.analysis.burnedTokens - a.analysis.burnedTokens)
    .slice(0, 10)
    .map(s => ({
      sessionId: s.id,
      firstMessage: s.firstMessage,
      turns: s.analysis.totalTurns,
      burnedTurns: s.analysis.burnedTurns,
      burnedTokens: s.analysis.burnedTokens,
      burnedCost: Math.round(s.analysis.burnedCost * 10000) / 10000,
    }));

  const burnPct = totalTokens === 0 ? 0 : Math.round((burnedTokens / totalTokens) * 1000) / 10;
  const oneShotRatePct = totalTurns === 0 ? 100 : Math.round(((totalTurns - burnedTurns) / totalTurns) * 1000) / 10;

  return {
    totalSessions: perSession.length,
    totalTurns,
    totalTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
    burnedTurns,
    burnedTokens,
    burnedCost: Math.round(burnedCost * 10000) / 10000,
    burnPct,
    oneShotRatePct,
    worstCategory: worst,
    byCategory,
    byDay,
    topBurnSessions,
    durationMs: Math.round(performance.now() - start),
  };
}
