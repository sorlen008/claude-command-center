import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { analyzeBurnForFile, buildBurnAnalytics, buildBurnTurns } from "../server/scanner/burn-analytics";

const tmpRoot = path.join(os.tmpdir(), "cc-burn-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));

function assistantLine(ts: string, model: string, usage: { input?: number; output?: number; cache_read?: number; cache_creation?: number }, toolUses: Array<{ name: string; input?: Record<string, unknown> }> = [], text = "ok") {
  const content: unknown[] = [{ type: "text", text }];
  for (const t of toolUses) {
    content.push({ type: "tool_use", id: `tu-${ts}-${t.name}`, name: t.name, input: t.input || {} });
  }
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    message: {
      role: "assistant",
      model,
      content,
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_read_input_tokens: usage.cache_read ?? 0,
        cache_creation_input_tokens: usage.cache_creation ?? 0,
      },
    },
  });
}

function userText(ts: string, text: string) {
  return JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: text } });
}

function userToolError(ts: string, text: string) {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu", is_error: true, content: text }],
    },
  });
}

function writeSession(name: string, lines: string[]): string {
  const fp = path.join(tmpRoot, name);
  fs.writeFileSync(fp, lines.join("\n") + "\n");
  return fp;
}

beforeAll(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("burn-analytics single-session", () => {
  it("clean one-shot edit: 0 burned, 100% one-shot", async () => {
    const file = writeSession("clean.jsonl", [
      userText("2026-04-15T10:00:00Z", "add a helper"),
      assistantLine("2026-04-15T10:00:10Z", "claude-sonnet-4-6", { input: 500, output: 200 }, [
        { name: "Edit", input: { file_path: "/src/foo.ts" } },
      ]),
      userText("2026-04-15T10:00:20Z", "thanks"),
      assistantLine("2026-04-15T10:00:25Z", "claude-sonnet-4-6", { input: 50, output: 20 }),
    ]);
    const a = await analyzeBurnForFile("s1", file);
    expect(a.turns.length).toBe(2);
    expect(a.burnedTurns).toBe(0);
    expect(a.burnedTokens).toBe(0);
    expect(a.turns[0].category).toBe("Coding");
    expect(a.turns[1].category).toBe("Conversation");
    expect(a.turns[0].burned).toBe(false);
  });

  it("same file edited twice within window: second edit is burned", async () => {
    const file = writeSession("retry.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 1000, output: 400 }, [
        { name: "Edit", input: { file_path: "/src/foo.ts" } },
      ]),
      userText("2026-04-15T10:00:30Z", "that's wrong, try again"),
      assistantLine("2026-04-15T10:00:40Z", "claude-sonnet-4-6", { input: 1000, output: 400 }, [
        { name: "Edit", input: { file_path: "/src/foo.ts" } },
      ]),
      assistantLine("2026-04-15T10:01:20Z", "claude-sonnet-4-6", { input: 500, output: 200 }, [
        { name: "Edit", input: { file_path: "/src/foo.ts" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s2", file);
    expect(a.turns.length).toBe(3);
    expect(a.turns[0].burned).toBe(false);
    expect(a.turns[1].burned).toBe(true);
    expect(a.turns[1].reason).toBe("repeat_edit");
    expect(a.turns[2].burned).toBe(true);
    expect(a.burnedTurns).toBe(2);
    expect(a.burnedTokens).toBe(1400 + 700);
  });

  it("repeat edit OUTSIDE 3-minute window is not burned", async () => {
    const file = writeSession("slow.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 500, output: 200 }, [
        { name: "Edit", input: { file_path: "/src/bar.ts" } },
      ]),
      assistantLine("2026-04-15T10:05:00Z", "claude-sonnet-4-6", { input: 500, output: 200 }, [
        { name: "Edit", input: { file_path: "/src/bar.ts" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s3", file);
    expect(a.burnedTurns).toBe(0);
  });

  it("coding turn following a tool_result error is burned", async () => {
    const file = writeSession("error.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 600, output: 100 }, [
        { name: "Bash", input: { command: "npm run vitest" } },
      ]),
      userToolError("2026-04-15T10:00:15Z", "test failed: assertion"),
      assistantLine("2026-04-15T10:00:30Z", "claude-sonnet-4-6", { input: 1000, output: 300 }, [
        { name: "Edit", input: { file_path: "/src/baz.ts" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s4", file);
    expect(a.turns[0].category).toBe("Testing");
    expect(a.turns[0].burned).toBe(false);
    expect(a.turns[1].category).toBe("Coding");
    expect(a.turns[1].burned).toBe(true);
    expect(a.turns[1].reason).toBe("error_after");
  });

  it("running the same test command twice within window is burned", async () => {
    const file = writeSession("test-repeat.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 300, output: 100 }, [
        { name: "Bash", input: { command: "vitest run tests/foo.test.ts" } },
      ]),
      assistantLine("2026-04-15T10:00:30Z", "claude-sonnet-4-6", { input: 300, output: 100 }, [
        { name: "Bash", input: { command: "vitest run tests/bar.test.ts" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s5", file);
    expect(a.turns[0].category).toBe("Testing");
    expect(a.turns[1].category).toBe("Testing");
    expect(a.turns[1].burned).toBe(true);
    expect(a.turns[1].reason).toBe("repeat_test");
  });

  it("git commit is categorized as Git Ops, not Build", async () => {
    const file = writeSession("git.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 50 }, [
        { name: "Bash", input: { command: "git commit -m 'fix'" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s6", file);
    expect(a.turns[0].category).toBe("Git Ops");
  });

  it("npm run build is categorized as Build", async () => {
    const file = writeSession("build.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 50 }, [
        { name: "Bash", input: { command: "npm run build" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s7", file);
    expect(a.turns[0].category).toBe("Build");
  });

  it("read/grep without edits is Exploration", async () => {
    const file = writeSession("explore.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 50 }, [
        { name: "Read", input: { file_path: "/src/index.ts" } },
        { name: "Grep", input: { pattern: "foo" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s8", file);
    expect(a.turns[0].category).toBe("Exploration");
    expect(a.turns[0].burned).toBe(false);
  });

  it("Task tool is Delegation", async () => {
    const file = writeSession("delegation.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 50 }, [
        { name: "Task", input: { description: "research" } },
      ]),
    ]);
    const a = await analyzeBurnForFile("s9", file);
    expect(a.turns[0].category).toBe("Delegation");
  });
});

describe("buildBurnTurns pure", () => {
  it("empty input yields empty output", () => {
    expect(buildBurnTurns([], [])).toEqual([]);
  });

  it("cache_read tokens are excluded from the active token count but counted in cost", () => {
    const turns = buildBurnTurns([
      { ts: "2026-04-15T10:00:00Z", model: "claude-sonnet-4-6", inputTokens: 100, outputTokens: 50, cacheReadTokens: 10000, cacheCreationTokens: 0, toolUses: [] },
    ], []);
    expect(turns[0].tokens).toBe(150);
    // Sonnet: 100*3 + 50*15 + 10000*0.3 = 300 + 750 + 3000 = 4050 per million
    expect(turns[0].cost).toBeCloseTo(4050 / 1_000_000, 8);
  });
});

describe("buildBurnAnalytics aggregator", () => {
  it("aggregates across multiple sessions and picks worst category", async () => {
    const fileA = writeSession("agg-a.jsonl", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 1000, output: 500 }, [
        { name: "Edit", input: { file_path: "/x.ts" } },
      ]),
      assistantLine("2026-04-15T10:00:30Z", "claude-sonnet-4-6", { input: 1000, output: 500 }, [
        { name: "Edit", input: { file_path: "/x.ts" } },
      ]),
      assistantLine("2026-04-15T10:01:00Z", "claude-sonnet-4-6", { input: 1000, output: 500 }, [
        { name: "Edit", input: { file_path: "/x.ts" } },
      ]),
      assistantLine("2026-04-15T10:01:30Z", "claude-sonnet-4-6", { input: 1000, output: 500 }, [
        { name: "Edit", input: { file_path: "/x.ts" } },
      ]),
    ]);
    const fileB = writeSession("agg-b.jsonl", [
      assistantLine("2026-04-15T11:00:00Z", "claude-sonnet-4-6", { input: 200, output: 100 }),
      assistantLine("2026-04-15T11:00:30Z", "claude-sonnet-4-6", { input: 200, output: 100 }),
    ]);

    const result = await buildBurnAnalytics([
      { id: "a", filePath: fileA, firstMessage: "session a" },
      { id: "b", filePath: fileB, firstMessage: "session b" },
    ]);

    expect(result.totalSessions).toBe(2);
    expect(result.totalTurns).toBe(6);
    expect(result.burnedTurns).toBe(3);
    // Session A: 4 turns x 1500 tokens = 6000. Session B: 2 x 300 = 600. Total = 6600.
    expect(result.totalTokens).toBe(6600);
    // Burned: 3 x 1500 = 4500
    expect(result.burnedTokens).toBe(4500);
    expect(result.burnPct).toBeGreaterThan(60);
    expect(result.worstCategory).toBe("Coding");

    const coding = result.byCategory.find(c => c.category === "Coding")!;
    expect(coding.turns).toBe(4);
    expect(coding.burnedTurns).toBe(3);
    expect(coding.oneShotRatePct).toBeCloseTo(25, 1);

    const conv = result.byCategory.find(c => c.category === "Conversation")!;
    expect(conv.turns).toBe(2);
    expect(conv.burnedTurns).toBe(0);
    expect(conv.oneShotRatePct).toBe(100);

    const topA = result.topBurnSessions.find(s => s.sessionId === "a");
    expect(topA).toBeDefined();
    expect(topA!.burnedTurns).toBe(3);
  });

  it("empty sessions list returns zeros", async () => {
    const result = await buildBurnAnalytics([]);
    expect(result.totalTurns).toBe(0);
    expect(result.burnPct).toBe(0);
    expect(result.oneShotRatePct).toBe(100);
    expect(result.worstCategory).toBeNull();
  });
});
