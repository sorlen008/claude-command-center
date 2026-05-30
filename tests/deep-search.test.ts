import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { SessionData, SessionSummary } from "@shared/types";
import { deepSearch } from "../server/scanner/deep-search";

const tmpRoot = path.join(os.tmpdir(), "cc-deep-search-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
fs.mkdirSync(tmpRoot, { recursive: true });

afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let seq = 0;
function makeSession(opts: {
  userTexts?: string[];
  asstTexts?: string[];
  firstTs?: string;
  lastTs?: string;
}): SessionData {
  const id = `sess-${seq++}`;
  const fp = path.join(tmpRoot, `${id}.jsonl`);
  const ts = opts.firstTs ?? "2026-05-30T00:00:00Z";
  const lines: string[] = [];
  for (const t of opts.userTexts ?? []) lines.push(JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: t } }));
  for (const t of opts.asstTexts ?? []) lines.push(JSON.stringify({ type: "assistant", timestamp: ts, message: { role: "assistant", content: [{ type: "text", text: t }] } }));
  fs.writeFileSync(fp, lines.join("\n") + "\n");
  return {
    id,
    filePath: fp,
    isEmpty: false,
    firstTs: ts,
    lastTs: opts.lastTs ?? ts,
    projectKey: "C--Users-test-proj",
    cwd: "/tmp/test-proj",
  } as unknown as SessionData;
}

describe("deepSearch", () => {
  it("matches a user message and returns a snippet", async () => {
    const sessions = [makeSession({ userTexts: ["the quick brown fox jumps"] })];
    const res = await deepSearch({ query: "quick fox", sessions });
    expect(res.results.length).toBe(1);
    expect(res.results[0].matchCount).toBeGreaterThanOrEqual(1);
    expect(res.results[0].matches[0].role).toBe("user");
    expect(res.results[0].matches[0].text.toLowerCase()).toContain("quick");
  });

  it("requires ALL query words to be present (AND semantics)", async () => {
    const sessions = [makeSession({ userTexts: ["only mentions alpha not the other word"] })];
    const res = await deepSearch({ query: "alpha betagamma", sessions });
    expect(res.results.length).toBe(0);
  });

  it("honours the field filter (assistant-only skips user matches)", async () => {
    const sessions = [makeSession({ userTexts: ["userland keyword zeta"], asstTexts: ["unrelated reply"] })];
    const res = await deepSearch({ query: "zeta", sessions, field: "assistant" });
    expect(res.results.length).toBe(0);
  });

  it("caps matches at 10 per session", async () => {
    const sessions = [makeSession({ userTexts: Array.from({ length: 15 }, (_, i) => `needle line ${i}`) })];
    const res = await deepSearch({ query: "needle", sessions });
    expect(res.results[0].matchCount).toBe(10);
  });

  it("appends a [Summary] match when the summary text matches", async () => {
    const s = makeSession({ userTexts: ["nothing relevant here"] });
    const summaries: Record<string, SessionSummary> = {
      [s.id]: { summary: "this summary mentions zephyr", generatedAt: "2026-05-30T00:00:00Z" } as unknown as SessionSummary,
    };
    const res = await deepSearch({ query: "zephyr", sessions: [s], summaries });
    expect(res.results.length).toBe(1);
    expect(res.results[0].matches[0].text.startsWith("[Summary] ")).toBe(true);
  });

  it("treats a date-only dateTo as inclusive end-of-day (v2.6.19 fix)", async () => {
    const sameDay = makeSession({ userTexts: ["omega marker"], firstTs: "2026-05-30T08:00:00Z" });
    const nextDay = makeSession({ userTexts: ["omega marker"], firstTs: "2026-05-31T09:00:00Z" });
    const res = await deepSearch({ query: "omega", sessions: [sameDay, nextDay], dateTo: "2026-05-30" });
    const ids = res.results.map((r) => r.sessionId);
    expect(ids).toContain(sameDay.id);   // 08:00 on the boundary day is kept...
    expect(ids).not.toContain(nextDay.id); // ...while the next day is excluded
  });
});
