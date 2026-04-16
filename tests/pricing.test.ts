import { describe, it, expect } from "vitest";
import { getMaxTokens, getPricing } from "../server/scanner/pricing";

describe("getPricing — 2026-04 rate update", () => {
  it("Opus 4.6 uses $5/$25 current rates (was $15/$75)", () => {
    const p = getPricing("claude-opus-4-6");
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
    expect(p.cacheRead).toBe(0.5);
    expect(p.cacheCreation).toBe(6.25);
  });

  it("Opus 4.5 also uses current reduced rates", () => {
    const p = getPricing("claude-opus-4-5");
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
  });

  it("Opus 4 / 4.1 keeps legacy $15/$75 rates for historical accuracy", () => {
    expect(getPricing("claude-opus-4").input).toBe(15);
    expect(getPricing("claude-opus-4-0").input).toBe(15);
    expect(getPricing("claude-opus-4-1").input).toBe(15);
  });

  it("Sonnet 4.6 pricing unchanged at $3/$15", () => {
    const p = getPricing("claude-sonnet-4-6");
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
    expect(p.cacheRead).toBe(0.3);
    expect(p.cacheCreation).toBe(3.75);
  });

  it("Haiku 4.5 uses $1/$5 (not the old $0.80/$4)", () => {
    const p = getPricing("claude-haiku-4-5");
    expect(p.input).toBe(1);
    expect(p.output).toBe(5);
    expect(p.cacheRead).toBe(0.1);
    expect(p.cacheCreation).toBe(1.25);
  });

  it("Haiku 3 keeps legacy $0.25/$1.25 for historical session replay", () => {
    expect(getPricing("claude-haiku-3").input).toBe(0.25);
    expect(getPricing("claude-haiku-3").output).toBe(1.25);
  });

  it("unknown models fall back to Sonnet rates", () => {
    const p = getPricing("some-unknown-model");
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  it("catch-all opus/haiku paths use current rates for unknown versions", () => {
    expect(getPricing("claude-opus-future").input).toBe(5);
    expect(getPricing("claude-haiku-future").input).toBe(1);
  });
});

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
