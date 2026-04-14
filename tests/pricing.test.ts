import { describe, it, expect } from "vitest";
import { getMaxTokens } from "../server/scanner/pricing";

describe("getMaxTokens", () => {
  it("Sonnet uses 200K window", () => {
    expect(getMaxTokens("claude-sonnet-4-6")).toBe(200_000);
  });

  it("Haiku uses 200K window", () => {
    expect(getMaxTokens("claude-haiku-4-5")).toBe(200_000);
  });

  it("Opus defaults to 200K when observed tokens are within the standard window", () => {
    expect(getMaxTokens("claude-opus-4-6")).toBe(200_000);
    expect(getMaxTokens("claude-opus-4-6", 162_157)).toBe(200_000);
    expect(getMaxTokens("claude-opus-4-6", 200_000)).toBe(200_000);
  });

  it("Opus auto-promotes to 1M when observed tokens exceed 200K (1M beta in use)", () => {
    expect(getMaxTokens("claude-opus-4-6", 200_001)).toBe(1_000_000);
    expect(getMaxTokens("claude-opus-4-6", 500_000)).toBe(1_000_000);
  });

  // Regression: Opus session with 162,157 tokens was showing 16% in CC vs 81% in CLI
  // because CC always assumed Opus = 1M ceiling. Lock the CLI's number in.
  it("Opus 162,157 tokens reports the same percentage as Claude Code CLI (81%, not 16%)", () => {
    const tokens = 162_157;
    const max = getMaxTokens("claude-opus-4-6", tokens);
    expect(Math.round((tokens / max) * 100)).toBe(81);
  });
});
