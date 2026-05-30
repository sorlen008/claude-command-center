import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Set up a temp CLAUDE_DIR before importing session-scanner.
// The session scanner uses CLAUDE_DIR from utils, so we need to mock it.
// We'll use a different approach: create temp session files and test
// the exported utility functions directly.

import { extractText, readHead, readTailTs } from "../server/scanner/utils";

// For scanAllSessions, we need to mock CLAUDE_DIR. We do this by
// creating a temp directory structure that mirrors ~/.claude/projects/<key>/
const tmpDir = path.join(os.tmpdir(), "cc-session-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
const claudeDir = path.join(tmpDir, ".claude");
const projectsDir = path.join(claudeDir, "projects");
const projectKey = "C--Users-test-myproject";
const projectSessionDir = path.join(projectsDir, projectKey);

function makeSessionLine(type: string, timestamp: string, extra?: Record<string, unknown>): string {
  const base: Record<string, unknown> = { type, timestamp, ...extra };
  return JSON.stringify(base);
}

function makeUserMessage(timestamp: string, content: string): string {
  return JSON.stringify({
    type: "user",
    timestamp,
    message: { role: "user", content },
  });
}

function makeAssistantMessage(timestamp: string, content: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: { role: "assistant", content },
  });
}

describe("session-scanner utilities", () => {
  const sessionDir = path.join(tmpDir, "sessions");

  beforeAll(() => {
    fs.mkdirSync(sessionDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readHead with session-like files", () => {
    it("parses session JSONL file and returns records", () => {
      const filePath = path.join(sessionDir, "session-a.jsonl");
      const lines = [
        makeSessionLine("system", "2025-06-01T10:00:00Z", { slug: "abc-123", cwd: "/test", version: "1.0" }),
        makeUserMessage("2025-06-01T10:01:00Z", "Hello world"),
        makeAssistantMessage("2025-06-01T10:01:30Z", "Hi there"),
        makeUserMessage("2025-06-01T10:02:00Z", "Can you help me with TypeScript?"),
        makeAssistantMessage("2025-06-01T10:02:30Z", "Of course!"),
      ];
      fs.writeFileSync(filePath, lines.join("\n") + "\n");

      const records = readHead(filePath, 10);
      expect(records).toHaveLength(5);
      expect(records[0].type).toBe("system");
      expect(records[0].slug).toBe("abc-123");
      expect(records[1].type).toBe("user");
      expect(records[2].type).toBe("assistant");
    });

    it("counts user and assistant messages correctly", () => {
      const filePath = path.join(sessionDir, "session-b.jsonl");
      const lines = [
        makeSessionLine("system", "2025-06-01T10:00:00Z", { slug: "def-456" }),
        makeUserMessage("2025-06-01T10:01:00Z", "First message"),
        makeAssistantMessage("2025-06-01T10:01:30Z", "Response 1"),
        makeUserMessage("2025-06-01T10:02:00Z", "Second message"),
        makeAssistantMessage("2025-06-01T10:02:30Z", "Response 2"),
        makeUserMessage("2025-06-01T10:03:00Z", "Third message"),
      ];
      fs.writeFileSync(filePath, lines.join("\n") + "\n");

      const records = readHead(filePath, 25);
      const messageCount = records.filter(
        (r: any) => r.type === "user" || r.type === "assistant"
      ).length;
      expect(messageCount).toBe(5);
    });
  });

  describe("readTailTs with session files", () => {
    it("returns the last timestamp from a session file", () => {
      const filePath = path.join(sessionDir, "session-c.jsonl");
      const lines = [
        makeSessionLine("system", "2025-06-01T10:00:00Z", {}),
        makeUserMessage("2025-06-01T10:01:00Z", "Hello"),
        makeAssistantMessage("2025-06-01T10:05:00Z", "Goodbye"),
      ];
      fs.writeFileSync(filePath, lines.join("\n") + "\n");

      const lastTs = readTailTs(filePath);
      expect(lastTs).toBe("2025-06-01T10:05:00Z");
    });
  });

  describe("extractText for tag extraction input", () => {
    it("extracts text from user message content (string)", () => {
      expect(extractText("hello world")).toBe("hello world");
    });

    it("extracts text from content block array", () => {
      const blocks = [
        { type: "text", text: "docker compose" },
        { type: "tool_use", id: "xyz" },
        { type: "text", text: "restart" },
      ];
      expect(extractText(blocks)).toBe("docker compose restart");
    });
  });
});

describe("tag extraction logic", () => {
  // Replicate the extractTags logic locally since it's not exported.
  // This tests the same algorithm the session scanner uses.
  const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "shall", "can", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "during", "before", "after", "above", "below", "up", "down", "out",
    "off", "over", "under", "again", "then", "once", "that", "this",
    "these", "those", "it", "its", "you", "your", "we", "our", "they",
    "their", "my", "me", "him", "her", "us", "them", "what", "which",
    "who", "how", "when", "where", "why", "all", "just", "also", "so",
    "not", "no", "if", "about", "want", "need", "help", "make", "use",
    "let", "get", "go", "know", "one", "any", "some", "more", "like",
    "please", "hi", "hello", "ok", "okay",
  ]);

  function extractTags(records: any[]): string[] {
    const textParts: string[] = [];
    for (const r of records) {
      if (r.type !== "user") continue;
      const msg = r.message;
      if (!msg || typeof msg !== "object") continue;
      if (msg.role !== "user") continue;
      const content = extractText(msg.content || "");
      if (content.includes("[Request interrupted") || content.includes("<local-command") || content.includes("<command-name>")) continue;
      textParts.push(content);
    }
    const fullText = textParts.join(" ").toLowerCase();
    const words = fullText.match(/[a-z][a-z0-9_-]{2,}/g) || [];
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (!STOPWORDS.has(w) && w.length >= 3) {
        freq[w] = (freq[w] || 0) + 1;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([w]) => w);
  }

  it("extracts top keywords from user messages", () => {
    const records = [
      { type: "user", message: { role: "user", content: "Fix the docker compose configuration" } },
      { type: "assistant", message: { role: "assistant", content: "Sure" } },
      { type: "user", message: { role: "user", content: "Also update the docker network settings" } },
      { type: "user", message: { role: "user", content: "Test the docker deployment" } },
    ];

    const tags = extractTags(records);
    expect(tags).toContain("docker");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(4);
  });

  it("returns empty array for no user messages", () => {
    const records = [
      { type: "system", timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { role: "assistant", content: "Hello" } },
    ];
    expect(extractTags(records)).toEqual([]);
  });

  it("skips messages with [Request interrupted", () => {
    const records = [
      { type: "user", message: { role: "user", content: "[Request interrupted by user]" } },
      { type: "user", message: { role: "user", content: "typescript compiler error" } },
    ];
    const tags = extractTags(records);
    // "request" and "interrupted" should NOT be in tags (that message was skipped)
    expect(tags).not.toContain("request");
    expect(tags).not.toContain("interrupted");
    expect(tags).toContain("typescript");
  });

  it("skips messages with <local-command", () => {
    const records = [
      { type: "user", message: { role: "user", content: "<local-command>status</local-command>" } },
      { type: "user", message: { role: "user", content: "fix the bug in server code" } },
    ];
    const tags = extractTags(records);
    expect(tags).not.toContain("local-command");
    expect(tags).toContain("server");
  });

  it("ignores stopwords and short words", () => {
    const records = [
      { type: "user", message: { role: "user", content: "the is a an but or and to of in for" } },
    ];
    const tags = extractTags(records);
    expect(tags).toEqual([]);
  });

  it("returns at most 4 tags sorted by frequency", () => {
    const records = [
      { type: "user", message: { role: "user", content: "alpha alpha alpha alpha beta beta beta gamma gamma delta epsilon epsilon" } },
    ];
    const tags = extractTags(records);
    expect(tags).toHaveLength(4);
    expect(tags[0]).toBe("alpha");
    expect(tags[1]).toBe("beta");
    // gamma and epsilon both have frequency 2; order depends on insertion order
    expect(tags[2]).toBe("gamma");
    expect(tags[3]).toBe("epsilon");
  });
});

describe("scanAllSessions with temp directory", () => {
  // For this test group, we set up a mock ~/.claude structure and
  // dynamically import the session scanner with the patched CLAUDE_DIR.
  const tmpScanDir = path.join(tmpDir, "scan-test");
  const fakeClaudeDir = path.join(tmpScanDir, ".claude");
  const fakeProjectsDir = path.join(fakeClaudeDir, "projects");
  const fakeProjectKey = "C--Users-test-project";
  const fakeSessionsDir = path.join(fakeClaudeDir, "sessions");

  beforeAll(() => {
    // Create the directory structure
    fs.mkdirSync(path.join(fakeProjectsDir, fakeProjectKey), { recursive: true });
    fs.mkdirSync(fakeSessionsDir, { recursive: true });

    // Create session files
    const session1Lines = [
      makeSessionLine("system", "2025-06-01T10:00:00Z", { slug: "sess-aaa", cwd: "C:/Users/test/project", version: "1.0" }),
      makeUserMessage("2025-06-01T10:01:00Z", "Create a new React component"),
      makeAssistantMessage("2025-06-01T10:01:30Z", "Sure, here it is"),
      makeUserMessage("2025-06-01T10:02:00Z", "Add TypeScript types"),
      makeAssistantMessage("2025-06-01T10:02:30Z", "Done"),
    ];
    fs.writeFileSync(
      path.join(fakeProjectsDir, fakeProjectKey, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"),
      session1Lines.join("\n") + "\n"
    );

    const session2Lines = [
      makeSessionLine("system", "2025-06-02T08:00:00Z", { slug: "sess-bbb", cwd: "C:/Users/test/project", version: "1.1" }),
      makeUserMessage("2025-06-02T08:01:00Z", "Fix the database migration"),
      makeAssistantMessage("2025-06-02T08:01:30Z", "Looking at it now"),
    ];
    fs.writeFileSync(
      path.join(fakeProjectsDir, fakeProjectKey, "ffffffff-1111-2222-3333-444444444444.jsonl"),
      session2Lines.join("\n") + "\n"
    );

    // Create an "active" session marker
    fs.writeFileSync(
      path.join(fakeSessionsDir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json"),
      JSON.stringify({ active: true })
    );
  });

  afterAll(() => {
    fs.rmSync(tmpScanDir, { recursive: true, force: true });
  });

  it("scans sessions from temp directory and returns correct counts", async () => {
    // We need to mock the CLAUDE_DIR constant used by the session scanner.
    // Use vi.doMock to override the utils module for this specific import.
    const { vi } = await import("vitest");

    // Mock the utils module to point CLAUDE_DIR to our fake directory
    vi.doMock("../server/scanner/utils", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../server/scanner/utils")>();
      return {
        ...actual,
        CLAUDE_DIR: fakeClaudeDir.replace(/\\/g, "/"),
      };
    });

    // Need to also ensure config module is available
    vi.doMock("../server/config", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../server/config")>();
      return actual;
    });

    // Dynamically import the session scanner with the mocked CLAUDE_DIR
    const { scanAllSessions } = await import("../server/scanner/session-scanner");

    const result = scanAllSessions();

    expect(result.sessions).toHaveLength(2);
    expect(result.stats.totalCount).toBe(2);
    expect(result.stats.totalSize).toBeGreaterThan(0);

    // Check that the active session was detected
    const activeSession = result.sessions.find((s) => s.id === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(activeSession).toBeDefined();
    expect(activeSession!.isActive).toBe(true);

    // Check the non-active session
    const otherSession = result.sessions.find((s) => s.id === "ffffffff-1111-2222-3333-444444444444");
    expect(otherSession).toBeDefined();
    expect(otherSession!.isActive).toBe(false);

    // Check perProject aggregation
    expect(result.perProject).toHaveLength(1);
    expect(result.perProject[0].projectKey).toBe(fakeProjectKey);
    expect(result.perProject[0].sessionCount).toBe(2);

    // Verify session has expected fields
    expect(activeSession!.slug).toBe("sess-aaa");
    expect(activeSession!.firstTs).toBe("2025-06-01T10:00:00Z");
    expect(activeSession!.messageCount).toBeGreaterThan(0);
    expect(activeSession!.projectKey).toBe(fakeProjectKey);

    // Verify sessions are sorted newest-first
    const firstTs = result.sessions[0].lastTs || result.sessions[0].firstTs || "";
    const secondTs = result.sessions[1].lastTs || result.sessions[1].firstTs || "";
    expect(firstTs >= secondTs).toBe(true);

    // Clean up mocks
    vi.doUnmock("../server/scanner/utils");
    vi.doUnmock("../server/config");
  });
});

describe("countMessages", () => {
  const dir = path.join(os.tmpdir(), "cc-count-msgs-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  // Imported dynamically (not at top level) so this doesn't evaluate
  // session-scanner before the scanAllSessions test sets up its CLAUDE_DIR mock.
  let countMessages: (filePath: string, mtimeMs: number, size: number) => number;
  beforeAll(async () => {
    fs.mkdirSync(dir, { recursive: true });
    ({ countMessages } = await import("../server/scanner/session-scanner"));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  function write(name: string, lines: object[]): string {
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return fp;
  }

  it("counts the WHOLE transcript, not just the first ~25 records (the old head-cap bug)", () => {
    const lines: object[] = [{ type: "system", subtype: "init" }];
    for (let i = 0; i < 30; i++) {
      lines.push({ type: "user", message: { role: "user", content: `q${i}` } });
      lines.push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "a" }] } });
    }
    const fp = write("big.jsonl", lines); // 60 user/assistant + 1 system
    const st = fs.statSync(fp);
    expect(countMessages(fp, st.mtimeMs, st.size)).toBe(60);
  });

  it("ignores non user/assistant records", () => {
    const fp = write("mixed.jsonl", [
      { type: "system", subtype: "init" },
      { type: "user", message: { role: "user", content: "hi" } },
      { type: "summary", summary: "x" },
      { type: "assistant", message: { role: "assistant", content: "ok" } },
    ]);
    const st = fs.statSync(fp);
    expect(countMessages(fp, st.mtimeMs, st.size)).toBe(2);
  });

  it("returns 0 for a missing file", () => {
    expect(countMessages(path.join(dir, "nope.jsonl"), 1, 1)).toBe(0);
  });
});
