import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Set COMMAND_CENTER_DATA before importing live-scanner/storage so the
// storage.recordObservedContext() side-effect of getSessionDetails() writes to
// a throwaway temp DB, never the real ~/.claude-command-center.
const tmpRoot = path.join(os.tmpdir(), "cc-live-scanner-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
fs.mkdirSync(tmpRoot, { recursive: true });
process.env.COMMAND_CENTER_DATA = path.join(tmpRoot, "data");

const { getSessionDetails, mapPermissionMode } = await import("../server/scanner/live-scanner");

// --- JSONL builders -------------------------------------------------------

let fileSeq = 0;
function writeJsonl(records: object[]): string {
  const fp = path.join(tmpRoot, `s-${fileSeq++}.jsonl`);
  fs.writeFileSync(fp, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return fp;
}

function asst(
  usage: Partial<{ input: number; output: number; cr: number; cc: number }> = {},
  model = "claude-sonnet-4-6",
  text = "ok",
): object {
  return {
    type: "assistant",
    timestamp: "2026-05-30T00:00:00Z",
    message: {
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_read_input_tokens: usage.cr ?? 0,
        cache_creation_input_tokens: usage.cc ?? 0,
      },
    },
  };
}

const user = (text: string) => ({ type: "user", timestamp: "2026-05-30T00:00:00Z", message: { role: "user", content: text } });
const userBlocks = (text: string) => ({ type: "user", timestamp: "2026-05-30T00:00:00Z", message: { role: "user", content: [{ type: "text", text }] } });
const permMode = (mode: string) => ({ type: "permission-mode", permissionMode: mode, timestamp: "2026-05-30T00:00:00Z" });

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// --- mapPermissionMode ----------------------------------------------------

describe("mapPermissionMode", () => {
  it("maps each raw Claude Code mode to its badge variant", () => {
    expect(mapPermissionMode("bypassPermissions")).toBe("bypass");
    expect(mapPermissionMode("acceptEdits")).toBe("auto-accept");
    expect(mapPermissionMode("plan")).toBe("plan");
    expect(mapPermissionMode("default")).toBe("default");
  });

  it("returns undefined for unknown or missing values", () => {
    expect(mapPermissionMode("somethingElse")).toBeUndefined();
    expect(mapPermissionMode(undefined)).toBeUndefined();
  });
});

// --- getSessionDetails: the stable contract the perf refactor must preserve --

describe("getSessionDetails — cost", () => {
  // Reproduces the v2.6.16 regression: opus-4.7/4.8 were matching the legacy
  // (3×) pricing regex. These exact token counts cost $12.00 at the reduced
  // opus-4.5+ tier (5/25/0.5/6.25 per Mtok) but $36.00 at the legacy tier —
  // so an exact-dollar assertion catches a tier mismatch that `cost > 0` can't.
  it("prices opus-4.5+ at the reduced tier (exact dollars)", () => {
    const fp = writeJsonl([
      user("hi"),
      asst({ input: 1_000_000, output: 200_000, cr: 2_000_000, cc: 160_000 }, "claude-opus-4-8"),
    ]);
    const d = getSessionDetails(fp);
    expect(d.costEstimate).toBe(12);
  });

  it("returns 0 cost when no usage tokens are present", () => {
    const fp = writeJsonl([user("hi"), asst({}, "claude-opus-4-8")]);
    expect(getSessionDetails(fp).costEstimate).toBe(0);
  });
});

describe("getSessionDetails — messageCount", () => {
  it("counts assistant records only (ignores user/system)", () => {
    const fp = writeJsonl([user("a"), asst({}), user("b"), asst({}), user("c")]);
    expect(getSessionDetails(fp).messageCount).toBe(2);
  });
});

describe("getSessionDetails — lastMessage", () => {
  it("picks the most recent human message and ignores assistant text", () => {
    const fp = writeJsonl([
      user("first question here"),
      asst({}, "claude-sonnet-4-6", "assistant reply text"),
      user("second question here"),
    ]);
    expect(getSessionDetails(fp).lastMessage).toBe("second question here");
  });

  it("extracts text from array-style user content blocks", () => {
    const fp = writeJsonl([userBlocks("array content msg"), asst({})]);
    expect(getSessionDetails(fp).lastMessage).toBe("array content msg");
  });

  it("collapses newlines and truncates to 4000 chars", () => {
    const fp = writeJsonl([user("line1\nline2"), asst({})]);
    expect(getSessionDetails(fp).lastMessage).toBe("line1 line2");

    const long = writeJsonl([user("x".repeat(5000)), asst({})]);
    expect(getSessionDetails(long).lastMessage!.length).toBe(4000);
  });
});

describe("getSessionDetails — contextUsage", () => {
  it("uses the last assistant record's tokens and the usable-budget formula", () => {
    const fp = writeJsonl([asst({ input: 50_000, cc: 10_000, cr: 30_000 }, "claude-sonnet-4-6")]);
    const d = getSessionDetails(fp);
    expect(d.contextUsage).toBeDefined();
    const ctx = d.contextUsage!;
    expect(ctx.tokensUsed).toBe(90_000); // input + cache_creation + cache_read
    expect(ctx.model).toBe("claude-sonnet-4-6");
    // Formula is asserted against the RETURNED usableTokens, so it can't be
    // contaminated by observed-context state persisted by other tests.
    expect(ctx.percentage).toBe(Math.min(100, Math.round((ctx.tokensUsed / ctx.usableTokens) * 100)));
    expect(ctx.usableTokens).toBe(200_000); // sonnet never promotes to the 1M window
  });
});

describe("getSessionDetails — permissionMode", () => {
  it("prefers the most recent (tail) permission-mode record over an earlier one", () => {
    const fp = writeJsonl([permMode("default"), user("x"), asst({}), permMode("bypassPermissions")]);
    expect(getSessionDetails(fp).permissionMode).toBe("bypass");
  });

  it("is undefined when the transcript has no permission-mode record", () => {
    const fp = writeJsonl([user("x"), asst({})]);
    expect(getSessionDetails(fp).permissionMode).toBeUndefined();
  });
});

describe("getSessionDetails — incremental parsing", () => {
  it("picks up records appended to a growing session", () => {
    const fp = writeJsonl([user("first question here"), asst({ input: 100 })]);
    const d1 = getSessionDetails(fp);
    expect(d1.messageCount).toBe(1);
    expect(d1.lastMessage).toBe("first question here");

    fs.appendFileSync(
      fp,
      JSON.stringify(user("second question here")) + "\n" + JSON.stringify(asst({ input: 200 })) + "\n",
    );
    const d2 = getSessionDetails(fp);
    expect(d2.messageCount).toBe(2); // both assistant records counted across reads
    expect(d2.lastMessage).toBe("second question here"); // newest human message wins
  });

  it("re-parses from scratch when a session is rewritten smaller (e.g. compaction)", () => {
    const fp = writeJsonl([
      user("x".repeat(500)),
      asst({ input: 100 }),
      user("y".repeat(500)),
      asst({ input: 200 }),
    ]);
    expect(getSessionDetails(fp).messageCount).toBe(2);

    // Compaction rewrites the transcript shorter — counts must reset, not accumulate.
    fs.writeFileSync(fp, JSON.stringify(user("short rewrite msg")) + "\n" + JSON.stringify(asst({ input: 50 })) + "\n");
    const d = getSessionDetails(fp);
    expect(d.messageCount).toBe(1);
    expect(d.lastMessage).toBe("short rewrite msg");
  });
});

describe("getSessionDetails — missing file", () => {
  it("degrades to zeros with no contextUsage or lastMessage", () => {
    const d = getSessionDetails(path.join(tmpRoot, "does-not-exist.jsonl"));
    expect(d.messageCount).toBe(0);
    expect(d.costEstimate).toBe(0);
    expect(d.contextUsage).toBeUndefined();
    expect(d.lastMessage).toBeUndefined();
  });
});
