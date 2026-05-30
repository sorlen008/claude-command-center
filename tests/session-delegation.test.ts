import { describe, it, expect } from "vitest";
import { sanitizePath } from "../server/scanner/session-delegation";

describe("sanitizePath", () => {
  it("strips shell metacharacters that could break out of a command", () => {
    expect(sanitizePath("a;b&c|d$e`f(g)h'i\"j*k")).toBe("abcdefghijk");
  });

  it("removes injection attempts while keeping the literal directory text", () => {
    const out = sanitizePath("dir && calc.exe");
    expect(out).not.toContain("&");
    expect(out).toContain("dir");
    expect(out).toContain("calc.exe");
  });

  it("preserves legitimate path characters (drive colon, slashes, dot, dash, underscore, space)", () => {
    const p = "C:/Users/alice/My Project_1.2-dir";
    expect(sanitizePath(p)).toBe(p);
  });

  it("preserves Windows backslash separators", () => {
    expect(sanitizePath("path\\to\\win")).toBe("path\\to\\win");
  });
});
