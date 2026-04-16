import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { extractTurns } from "../server/scanner/turn-extractor";
import { buildHistoricalLimits, parseResetTextToIso } from "../server/scanner/historical-limits";

const tmpRoot = path.join(os.tmpdir(), "cc-hist-limits-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
const fakeProjectsDir = path.join(tmpRoot, "projects");
const PROJECT_KEY = "C--Users-test-proj";

function assistantLine(ts: string, model: string, usage: { input?: number; output?: number; cache_creation?: number }, text = "ok") {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      role: "assistant", model,
      content: [{ type: "text", text }],
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: usage.cache_creation ?? 0,
      },
    },
  });
}

function rateLimitLine(ts: string, resetText = "12am (America/Los_Angeles)") {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    error: "rate_limit",
    isApiErrorMessage: true,
    message: {
      role: "assistant", model: "<synthetic>",
      content: [{ type: "text", text: `You've hit your limit · resets ${resetText}` }],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
}

function writeSession(id: string, lines: string[]) {
  const projDir = path.join(fakeProjectsDir, PROJECT_KEY);
  fs.mkdirSync(projDir, { recursive: true });
  const fp = path.join(projDir, `${id}.jsonl`);
  fs.writeFileSync(fp, lines.join("\n") + "\n");
  const first = lines[0] ? JSON.parse(lines[0]).timestamp || null : null;
  const last = lines[lines.length - 1] ? JSON.parse(lines[lines.length - 1]).timestamp || first : first;
  return { id, filePath: fp, projectKey: PROJECT_KEY, firstTs: first, lastTs: last };
}

beforeAll(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("extractTurns — rate_limit events", () => {
  it("returns an empty rateLimitEvents when there are none", async () => {
    const fp = path.join(tmpRoot, "plain.jsonl");
    fs.writeFileSync(fp, [assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 10, output: 5 })].join("\n") + "\n");
    const r = await extractTurns(fp);
    expect(r.rateLimitEvents).toEqual([]);
  });

  it("detects synthetic rate_limit messages and extracts reset text", async () => {
    const fp = path.join(tmpRoot, "limited.jsonl");
    fs.writeFileSync(fp, [
      assistantLine("2026-04-15T10:00:00Z", "claude-opus-4-6", { input: 1000, output: 500 }),
      rateLimitLine("2026-04-15T11:00:00Z", "11pm (America/Los_Angeles)"),
    ].join("\n") + "\n");
    const r = await extractTurns(fp);
    expect(r.rateLimitEvents.length).toBe(1);
    expect(r.rateLimitEvents[0].ts).toBe("2026-04-15T11:00:00Z");
    expect(r.rateLimitEvents[0].resetText).toBe("11pm (America/Los_Angeles)");
    // The synthetic limit message must NOT be counted as a normal turn.
    expect(r.turns.length).toBe(1);
  });

  it("handles missing reset text gracefully", async () => {
    const fp = path.join(tmpRoot, "nomatch.jsonl");
    fs.writeFileSync(fp, [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-15T11:00:00Z",
        error: "rate_limit",
        isApiErrorMessage: true,
        message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "You have hit a limit" }], usage: {} },
      }),
    ].join("\n") + "\n");
    const r = await extractTurns(fp);
    expect(r.rateLimitEvents.length).toBe(1);
    expect(r.rateLimitEvents[0].resetText).toBe("");
  });
});

describe("parseResetTextToIso", () => {
  it("returns null for empty or malformed input", () => {
    expect(parseResetTextToIso("", "2026-04-15T10:00:00Z")).toBeNull();
    expect(parseResetTextToIso("garbage", "2026-04-15T10:00:00Z")).toBeNull();
  });

  it("parses '11pm (America/Los_Angeles)' into a future ISO after the hit", () => {
    const iso = parseResetTextToIso("11pm (America/Los_Angeles)", "2026-04-15T10:00:00Z");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect(d.getTime()).toBeGreaterThan(Date.parse("2026-04-15T10:00:00Z"));
    // LA 23:00 local = 06:00 UTC the next day; accept ±1h slop for DST edge cases.
    expect(Math.abs(d.getUTCHours() - 6)).toBeLessThanOrEqual(1);
  });

  it("rolls to tomorrow if the hour has already passed", () => {
    // Hit at 02:00 UTC (19:00 local LA previous day). Reset "1am" parsed from
    // hit-time LA date lands before the hit — should roll forward one day.
    const iso = parseResetTextToIso("1am (America/Los_Angeles)", "2026-04-15T02:00:00Z");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect(d.getTime()).toBeGreaterThan(Date.parse("2026-04-15T02:00:00Z"));
  });
});

describe("buildHistoricalLimits", () => {
  it("returns empty shape when no sessions have rate-limit events", async () => {
    const sess = writeSession("clean", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 50 }),
    ]);
    const r = await buildHistoricalLimits([sess], { claudeProjectsDir: fakeProjectsDir, now: new Date("2026-04-16T12:00:00Z") });
    expect(r.totalHits).toBe(0);
    expect(r.medianTokens).toBeNull();
    expect(r.mostRecent).toBeNull();
  });

  it("reconstructs the 5h window leading to a hit and reports tokens/hours/model", async () => {
    const sess = writeSession("hit-a", [
      // Window opens
      assistantLine("2026-04-15T08:00:00Z", "claude-opus-4-6", { input: 20000, output: 5000 }),
      assistantLine("2026-04-15T09:00:00Z", "claude-opus-4-6", { input: 40000, output: 10000 }),
      assistantLine("2026-04-15T10:00:00Z", "claude-opus-4-6", { input: 60000, output: 15000 }),
      assistantLine("2026-04-15T11:00:00Z", "claude-opus-4-6", { input: 80000, output: 20000 }),
      // Anthropic says enough
      rateLimitLine("2026-04-15T11:30:00Z", "4pm (America/Los_Angeles)"),
    ]);
    const r = await buildHistoricalLimits([sess], { claudeProjectsDir: fakeProjectsDir, now: new Date("2026-04-16T12:00:00Z") });
    expect(r.totalHits).toBe(1);
    const hit = r.hits[0];
    expect(hit.turnsInWindow).toBe(4); // 4 Opus turns before the limit fired
    expect(hit.dominantModel).toBe("opus");
    // 20000+5000 + 40000+10000 + 60000+15000 + 80000+20000 = 250000
    expect(hit.tokensInWindow).toBe(250000);
    expect(hit.resetText).toBe("4pm (America/Los_Angeles)");
    expect(r.medianTokens).toBe(250000);
  });

  it("excludes hits older than 90 days", async () => {
    const sess = writeSession("ancient", [
      assistantLine("2025-10-15T10:00:00Z", "claude-opus-4-6", { input: 5000, output: 1000 }),
      rateLimitLine("2025-10-15T12:00:00Z", "4pm (America/Los_Angeles)"),
    ]);
    const r = await buildHistoricalLimits([sess], { claudeProjectsDir: fakeProjectsDir, now: new Date("2026-04-16T12:00:00Z") });
    expect(r.totalHits).toBe(0);
  });

  it("computes median across multiple hits", async () => {
    const a = writeSession("mult-a", [
      assistantLine("2026-04-10T08:00:00Z", "claude-opus-4-6", { input: 50000, output: 10000 }),
      rateLimitLine("2026-04-10T09:00:00Z"),
    ]);
    const b = writeSession("mult-b", [
      assistantLine("2026-04-12T08:00:00Z", "claude-opus-4-6", { input: 100000, output: 20000 }),
      rateLimitLine("2026-04-12T09:00:00Z"),
    ]);
    const c = writeSession("mult-c", [
      assistantLine("2026-04-14T08:00:00Z", "claude-opus-4-6", { input: 30000, output: 5000 }),
      rateLimitLine("2026-04-14T09:00:00Z"),
    ]);
    const r = await buildHistoricalLimits([a, b, c], { claudeProjectsDir: fakeProjectsDir, now: new Date("2026-04-16T12:00:00Z") });
    expect(r.totalHits).toBe(3);
    // Tokens per window: 60000, 120000, 35000 → sorted [35000, 60000, 120000] → median 60000
    expect(r.medianTokens).toBe(60000);
    // Most recent is mult-c on 2026-04-14
    expect(r.mostRecent?.hitAtIso).toBe("2026-04-14T09:00:00Z");
  });

  it("reports opus share correctly", async () => {
    const a = writeSession("s-a", [
      assistantLine("2026-04-10T08:00:00Z", "claude-opus-4-6", { input: 50000, output: 10000 }),
      rateLimitLine("2026-04-10T09:00:00Z"),
    ]);
    const b = writeSession("s-b", [
      assistantLine("2026-04-12T08:00:00Z", "claude-sonnet-4-6", { input: 50000, output: 10000 }),
      rateLimitLine("2026-04-12T09:00:00Z"),
    ]);
    const r = await buildHistoricalLimits([a, b], { claudeProjectsDir: fakeProjectsDir, now: new Date("2026-04-16T12:00:00Z") });
    expect(r.opusShareAtHitPct).toBe(50);
  });
});
