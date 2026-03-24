/**
 * New-User Safety Tests
 *
 * These tests ensure the Command Center works cleanly for any user who clones
 * the repo — no hardcoded paths, no PII, no Saeed-specific references, and all
 * features degrade gracefully when external services aren't available.
 *
 * Run: npx vitest run tests/new-user-safety.test.ts
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");

/** Recursively get all .ts/.tsx files in a directory, excluding node_modules/dist */
function getSourceFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", ".git", "data"].includes(entry.name)) continue;
        files.push(...getSourceFiles(full));
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        files.push(full);
      }
    }
  } catch {}
  return files;
}

describe("No hardcoded user-specific paths", () => {
  const sourceFiles = getSourceFiles(ROOT);
  const BANNED_PATTERNS = [
    { pattern: /C:[/\\]Users[/\\]zwin0/gi, label: "Hardcoded path C:/Users/zwin0" },
    { pattern: /C--Users-zwin0/g, label: "Hardcoded encoded project key C--Users-zwin0" },
    { pattern: /\/Users\/hi\//g, label: "Hardcoded Mac Mini path /Users/hi/" },
    { pattern: /100\.67\.236\.104/g, label: "Hardcoded Tailscale IP" },
    { pattern: /sorlen008@gmail/g, label: "Hardcoded email address" },
  ];

  // Whitelist: files where these patterns are acceptable (test files, configs)
  const WHITELIST = [
    "new-user-safety.test.ts", // this test file itself
    "parsers.test.ts",         // test fixtures may contain example data
  ];

  for (const file of sourceFiles) {
    const basename = path.basename(file);
    if (WHITELIST.includes(basename)) continue;
    const relPath = path.relative(ROOT, file).replace(/\\/g, "/");

    for (const { pattern, label } of BANNED_PATTERNS) {
      it(`${relPath} — no ${label}`, () => {
        const content = fs.readFileSync(file, "utf-8");
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
        const matches = content.match(pattern);
        expect(matches, `Found ${label} in ${relPath}: ${matches?.join(", ")}`).toBeNull();
      });
    }
  }
});

describe("No hardcoded phone numbers", () => {
  const sourceFiles = getSourceFiles(ROOT);
  // Match phone numbers like +15551234567, +442071234567 (but not in test/comment explaining the pattern)
  const PHONE_PATTERN = /[+"]\+?\d{10,15}"/g;
  const WHITELIST = ["new-user-safety.test.ts"];

  for (const file of sourceFiles) {
    const basename = path.basename(file);
    if (WHITELIST.includes(basename)) continue;
    const relPath = path.relative(ROOT, file).replace(/\\/g, "/");

    it(`${relPath} — no hardcoded phone numbers`, () => {
      const content = fs.readFileSync(file, "utf-8");
      PHONE_PATTERN.lastIndex = 0;
      const matches = content.match(PHONE_PATTERN);
      // Filter out things that are clearly not phone numbers (port numbers, hex, etc.)
      const phoneMatches = matches?.filter(m => {
        const digits = m.replace(/[^0-9]/g, "");
        return digits.length >= 10 && m.includes("+");
      });
      expect(phoneMatches?.length || 0, `Found phone number in ${relPath}: ${phoneMatches?.join(", ")}`).toBe(0);
    });
  }
});

describe("No Saeed-specific project names in user-facing UI text", () => {
  const UI_FILES = getSourceFiles(path.join(ROOT, "client", "src"));
  const BANNED_UI_STRINGS = [
    { pattern: /Nicora Desk/g, label: "Nicora Desk (developer-specific project)" },
    { pattern: /findash/gi, label: "findash (developer-specific project)" },
    { pattern: /Cooper(?![\w])/g, label: "Cooper (developer-specific assistant)" },
    { pattern: /Villa Project/g, label: "Villa Project (developer-specific project)" },
  ];

  for (const file of UI_FILES) {
    const relPath = path.relative(ROOT, file).replace(/\\/g, "/");
    for (const { pattern, label } of BANNED_UI_STRINGS) {
      it(`${relPath} — no reference to ${label}`, () => {
        const content = fs.readFileSync(file, "utf-8");
        pattern.lastIndex = 0;
        const matches = content.match(pattern);
        expect(matches, `Found ${label} in ${relPath}`).toBeNull();
      });
    }
  }
});

describe("Graceful degradation without Claude CLI", () => {
  it("session-summarizer handles spawn failure", async () => {
    // The summarizer's runClaude function rejects on non-zero exit or error
    // Routes check isClaudeAvailable() before calling summarizer
    const routeContent = fs.readFileSync(path.join(ROOT, "server/routes/sessions.ts"), "utf-8");
    expect(routeContent).toContain("isClaudeAvailable()");
  });

  it("isClaudeAvailable check exists before summarize", () => {
    const content = fs.readFileSync(path.join(ROOT, "server/routes/sessions.ts"), "utf-8");
    // Find the summarize route and verify it checks CLI availability
    const summarizeIdx = content.indexOf("/api/sessions/:id/summarize");
    const batchIdx = content.indexOf("/api/sessions/summarize-batch");
    const nlIdx = content.indexOf("/api/sessions/nl-query");
    const decisionIdx = content.indexOf("/api/sessions/decisions/extract");

    // Each should have isClaudeAvailable check nearby (within 200 chars)
    for (const [name, idx] of [["summarize", summarizeIdx], ["batch", batchIdx], ["nl-query", nlIdx], ["decisions", decisionIdx]]) {
      expect(idx, `${name} route not found`).toBeGreaterThan(-1);
      const snippet = content.slice(idx, idx + 300);
      expect(snippet, `${name} route missing isClaudeAvailable check`).toContain("isClaudeAvailable");
    }
  });
});

describe("Nerve center services are configurable", () => {
  it("defaults to just Command Center when no env var set", () => {
    const content = fs.readFileSync(path.join(ROOT, "server/scanner/nerve-center.ts"), "utf-8");
    expect(content).toContain("NERVE_CENTER_SERVICES");
    expect(content).toContain("defaultServices");
  });
});

describe("Voice delegation requires env var config", () => {
  it("does not hardcode phone numbers or paths", () => {
    const content = fs.readFileSync(path.join(ROOT, "server/scanner/session-delegation.ts"), "utf-8");
    expect(content).toContain("VOICE_CALLER_SCRIPT");
    expect(content).toContain("VOICE_PHONE");
    expect(content).not.toContain("C:/Users/zwin0");
    expect(content).not.toContain("+971");
  });
});

describe("Terminal delegation is cross-platform", () => {
  it("handles win32, darwin, and linux", () => {
    const content = fs.readFileSync(path.join(ROOT, "server/scanner/session-delegation.ts"), "utf-8");
    expect(content).toContain("win32");
    expect(content).toContain("darwin");
    expect(content).toContain("x-terminal-emulator");
  });
});
