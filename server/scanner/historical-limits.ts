import fs from "fs";
import path from "path";
import { extractTurns, type RawTurn, type RateLimitEvent } from "./turn-extractor";
import { getPricing, computeCost } from "./pricing";
import type { HistoricalLimitHit, HistoricalLimits } from "@shared/types";

interface SessionMetaLite {
  id: string;
  filePath: string;
  projectKey: string;
  firstTs: string | null;
  lastTs: string | null;
}

interface TurnWithModel {
  ms: number;
  model: string;
  activeTokens: number;
  cost: number;
}

const LOOKBACK_DAYS = 90;
const DEFAULT_WINDOW_HOURS = 5;

/**
 * Parse "resets 11pm (America/Los_Angeles)" into a concrete future ISO near the hit timestamp.
 * Best-effort: the text format is short-code, not machine-friendly, so the resulting
 * ISO is approximate (within ~30 minutes due to timezone-offset gymnastics).
 */
export function parseResetTextToIso(resetText: string, hitIso: string): string | null {
  if (!resetText) return null;
  const m = resetText.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([^)]+)\)$/i);
  if (!m) return null;
  const rawHour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3]?.toLowerCase();
  let hour = rawHour;
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;

  const hitMs = Date.parse(hitIso);
  if (!Number.isFinite(hitMs)) return null;

  const tz = m[4];
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", minute: "2-digit",
    });
    const parts = fmt.formatToParts(new Date(hitMs)).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const y = parseInt(parts.year, 10);
    const mo = parseInt(parts.month, 10);
    const d = parseInt(parts.day, 10);
    const pad = (n: number) => String(n).padStart(2, "0");
    const candidateLocalIso = `${y}-${pad(mo)}-${pad(d)}T${pad(hour)}:${pad(minute)}:00`;
    const candidate = zonedTimeToUtc(candidateLocalIso, tz);
    if (candidate.getTime() <= hitMs) {
      candidate.setTime(candidate.getTime() + 24 * 60 * 60 * 1000);
    }
    return candidate.toISOString();
  } catch {
    return null;
  }
}

function zonedTimeToUtc(localIso: string, tz: string): Date {
  const [date, time] = localIso.split("T");
  const [Y, M, D] = date.split("-").map(n => parseInt(n, 10));
  const [h, mi, s] = time.split(":").map(n => parseInt(n, 10));
  const guess = Date.UTC(Y, M - 1, D, h, mi, s || 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date(guess)).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const tzY = parseInt(parts.year, 10);
  const tzM = parseInt(parts.month, 10);
  const tzD = parseInt(parts.day, 10);
  const tzH = parseInt(parts.hour, 10) % 24;
  const tzMi = parseInt(parts.minute, 10);
  const tzS = parseInt(parts.second, 10);
  const tzAsUtc = Date.UTC(tzY, tzM - 1, tzD, tzH, tzMi, tzS);
  const offset = guess - tzAsUtc;
  return new Date(guess + offset);
}

function dominantModelIn(turns: TurnWithModel[]): string {
  if (turns.length === 0) return "unknown";
  const byModel = new Map<string, number>();
  for (const t of turns) {
    const key = /opus/i.test(t.model) ? "opus" : /sonnet/i.test(t.model) ? "sonnet" : /haiku/i.test(t.model) ? "haiku" : "other";
    byModel.set(key, (byModel.get(key) || 0) + t.activeTokens);
  }
  let best = "other", bestVal = -1;
  for (const [k, v] of Array.from(byModel.entries())) {
    if (v > bestVal) { best = k; bestVal = v; }
  }
  return best;
}

function estimateHours(sorted: TurnWithModel[]): number {
  if (sorted.length < 2) return 0;
  const CAP_MS = 30 * 60 * 1000;
  let totalMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].ms - sorted[i - 1].ms;
    if (gap > 0 && gap < CAP_MS) totalMs += gap;
  }
  return Math.round((totalMs / (60 * 60 * 1000)) * 10) / 10;
}

function reconstructWindowAtHit(allTurnsAsc: TurnWithModel[], hitMs: number, windowHours: number): TurnWithModel[] {
  const windowMs = windowHours * 60 * 60 * 1000;
  const cutoff = hitMs - windowMs;
  return allTurnsAsc.filter(t => t.ms < hitMs && t.ms >= cutoff);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Nearest-rank percentile. Returns null if the list is empty.
 * p is in [0, 1]. For small samples (n < 4) the interpretation is loose:
 * p25 ≈ min, p90 ≈ max. Callers must disclose sample size to the user.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

async function collectAllForSession(sess: SessionMetaLite, claudeProjectsDir: string): Promise<{ turns: TurnWithModel[]; events: RateLimitEvent[] }> {
  const parent = await extractTurns(sess.filePath);
  const subDir = path.join(claudeProjectsDir, sess.projectKey, sess.id, "subagents");
  const subFiles = fs.existsSync(subDir)
    ? fs.readdirSync(subDir).filter(f => f.startsWith("agent-") && f.endsWith(".jsonl")).map(f => path.join(subDir, f))
    : [];
  const subs = await Promise.all(subFiles.map(fp => extractTurns(fp)));
  const rawTurns: RawTurn[] = [...parent.turns];
  for (const s of subs) rawTurns.push(...s.turns);
  const turns: TurnWithModel[] = rawTurns
    .filter(t => t.ts)
    .map(t => {
      const ms = Date.parse(t.ts);
      if (!Number.isFinite(ms)) return null;
      const active = t.inputTokens + t.outputTokens + t.cacheCreationTokens;
      const cost = computeCost(getPricing(t.model), t.inputTokens, t.outputTokens, t.cacheReadTokens, t.cacheCreationTokens);
      return { ms, model: t.model, activeTokens: active, cost };
    })
    .filter((t): t is TurnWithModel => t !== null);
  turns.sort((a, b) => a.ms - b.ms);
  return { turns, events: parent.rateLimitEvents };
}

export async function buildHistoricalLimits(
  sessions: SessionMetaLite[],
  opts: { claudeProjectsDir: string; windowHours?: number; now?: Date }
): Promise<HistoricalLimits> {
  const now = opts.now || new Date();
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const cutoffMs = now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  const hits: HistoricalLimitHit[] = [];

  const BATCH = 20;
  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(s => collectAllForSession(s, opts.claudeProjectsDir)));
    for (const { turns, events } of results) {
      if (events.length === 0) continue;
      for (const ev of events) {
        const hitMs = Date.parse(ev.ts);
        if (!Number.isFinite(hitMs) || hitMs < cutoffMs) continue;
        const window = reconstructWindowAtHit(turns, hitMs, windowHours);
        const tokensInWindow = window.reduce((s, t) => s + t.activeTokens, 0);
        const hoursInWindow = estimateHours(window);
        hits.push({
          hitAtIso: ev.ts,
          resetText: ev.resetText,
          resetAtIso: parseResetTextToIso(ev.resetText, ev.ts),
          tokensInWindow,
          hoursInWindow,
          dominantModel: dominantModelIn(window),
          turnsInWindow: window.length,
        });
      }
    }
  }

  hits.sort((a, b) => Date.parse(b.hitAtIso) - Date.parse(a.hitAtIso));

  const tokenSamples = hits.filter(h => h.tokensInWindow > 0).map(h => h.tokensInWindow);
  const hourSamples = hits.filter(h => h.hoursInWindow > 0).map(h => h.hoursInWindow);
  const medianTokens = median(tokenSamples);
  const medianHours = median(hourSamples);
  const p25 = percentile(tokenSamples, 0.25);
  const p50 = percentile(tokenSamples, 0.5);
  const p90 = percentile(tokenSamples, 0.9);

  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const last30 = hits.filter(h => Date.parse(h.hitAtIso) >= thirtyDaysAgo);

  const opusHits = hits.filter(h => h.dominantModel === "opus").length;
  const opusShareAtHitPct = hits.length === 0 ? null : Math.round((opusHits / hits.length) * 1000) / 10;

  return {
    hits: hits.slice(0, 50),
    totalHits: hits.length,
    totalHitsLast30Days: last30.length,
    medianTokens: medianTokens !== null ? Math.round(medianTokens) : null,
    medianHours: medianHours !== null ? Math.round(medianHours * 10) / 10 : null,
    p25Tokens: p25 !== null ? Math.round(p25) : null,
    p50Tokens: p50 !== null ? Math.round(p50) : null,
    p90Tokens: p90 !== null ? Math.round(p90) : null,
    mostRecent: hits[0] || null,
    opusShareAtHitPct,
    sampleSize: hits.length,
  };
}
