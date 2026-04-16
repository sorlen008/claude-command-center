import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { extractTurns, classifyOrigin } from "../server/scanner/turn-extractor";

const tmpRoot = path.join(os.tmpdir(), "cc-turn-extractor-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));

function writeJsonl(name: string, lines: string[]): string {
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

describe("extractTurns", () => {
  it("returns empty on nonexistent file", async () => {
    const result = await extractTurns(path.join(tmpRoot, "nope.jsonl"));
    expect(result.turns).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.firstUserMessage).toBe("");
    expect(result.isSidechain).toBe(false);
  });

  it("parses assistant usage into RawTurn", async () => {
    const fp = writeJsonl("simple.jsonl", [
      JSON.stringify({ type: "user", timestamp: "2026-04-01T10:00:00Z", message: { role: "user", content: "hi" } }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-01T10:00:05Z",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
        },
      }),
    ]);
    const r = await extractTurns(fp);
    expect(r.turns.length).toBe(1);
    expect(r.turns[0].inputTokens).toBe(10);
    expect(r.turns[0].outputTokens).toBe(5);
    expect(r.turns[0].cacheReadTokens).toBe(100);
    expect(r.turns[0].cacheCreationTokens).toBe(20);
    expect(r.turns[0].model).toBe("claude-sonnet-4-6");
    expect(r.firstUserMessage).toBe("hi");
  });

  it("extracts tool_use blocks with name and input", async () => {
    const fp = writeJsonl("tools.jsonl", [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-04-01T10:00:00Z",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          content: [
            { type: "tool_use", id: "tu1", name: "Bash", input: { command: "git status" } },
            { type: "tool_use", id: "tu2", name: "mcp__playwright__browser_click", input: { ref: "e1" } },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
    ]);
    const r = await extractTurns(fp);
    expect(r.turns[0].toolUses.length).toBe(2);
    expect(r.turns[0].toolUses[0].name).toBe("Bash");
    expect(r.turns[0].toolUses[0].input.command).toBe("git status");
    expect(r.turns[0].toolUses[1].name).toBe("mcp__playwright__browser_click");
  });

  it("extracts tool_result errors with text", async () => {
    const fp = writeJsonl("errors.jsonl", [
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-01T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "permission denied" }],
        },
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-01T10:00:10Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu2", is_error: true, content: [{ type: "text", text: "test failed: expect()" }] }],
        },
      }),
    ]);
    const r = await extractTurns(fp);
    expect(r.errors.length).toBe(2);
    expect(r.errors[0].text).toBe("permission denied");
    expect(r.errors[1].text).toContain("test failed");
  });

  it("flags isSidechain from first record", async () => {
    const fp = writeJsonl("sidechain.jsonl", [
      JSON.stringify({ isSidechain: true, type: "user", timestamp: "2026-04-01T10:00:00Z", message: { role: "user", content: "subagent prompt" } }),
    ]);
    const r = await extractTurns(fp);
    expect(r.isSidechain).toBe(true);
  });

  it("isSidechain false when missing or explicit false", async () => {
    const fp = writeJsonl("not-sidechain.jsonl", [
      JSON.stringify({ isSidechain: false, type: "user", timestamp: "2026-04-01T10:00:00Z", message: { role: "user", content: "hi" } }),
    ]);
    const r = await extractTurns(fp);
    expect(r.isSidechain).toBe(false);
  });

  it("captures entrypoint from first record", async () => {
    const fp = writeJsonl("entrypoint.jsonl", [
      JSON.stringify({ entrypoint: "cli", type: "user", timestamp: "2026-04-01T10:00:00Z", message: { role: "user", content: "hi" } }),
    ]);
    const r = await extractTurns(fp);
    expect(r.entrypoint).toBe("cli");
  });

  it("skips malformed JSON lines", async () => {
    const fp = writeJsonl("bad.jsonl", [
      "not json",
      JSON.stringify({ type: "assistant", timestamp: "2026-04-01T10:00:00Z", message: { role: "assistant", model: "claude-sonnet-4-6", content: [], usage: { input_tokens: 5, output_tokens: 2 } } }),
      "{ broken",
    ]);
    const r = await extractTurns(fp);
    expect(r.turns.length).toBe(1);
    expect(r.turns[0].inputTokens).toBe(5);
  });

  it("firstUserMessage handles string content and text-array content", async () => {
    const fpA = writeJsonl("str.jsonl", [
      JSON.stringify({ type: "user", timestamp: "2026-04-01T10:00:00Z", message: { role: "user", content: "plain string" } }),
    ]);
    const fpB = writeJsonl("arr.jsonl", [
      JSON.stringify({ type: "user", timestamp: "2026-04-01T10:00:00Z", message: { role: "user", content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] } }),
    ]);
    const a = await extractTurns(fpA);
    const b = await extractTurns(fpB);
    expect(a.firstUserMessage).toBe("plain string");
    expect(b.firstUserMessage).toBe("first second");
  });
});

describe("classifyOrigin", () => {
  it("classifies normal human message as interactive", () => {
    expect(classifyOrigin("fix the bug in auth.ts")).toBe("interactive");
    expect(classifyOrigin("")).toBe("interactive");
  });

  it("classifies tool_call tag as hook", () => {
    expect(classifyOrigin("<tool_call>do something</tool_call>")).toBe("hook");
    expect(classifyOrigin("<local-command>status</local-command>")).toBe("hook");
  });

  it("classifies [Task] preamble as subagent", () => {
    expect(classifyOrigin("[Task] research this")).toBe("subagent");
    expect(classifyOrigin("<task>research this</task>")).toBe("subagent");
  });
});
