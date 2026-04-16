import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  buildDashboardAnalytics,
  computeRangeCutoff,
  type SessionMeta,
} from "../server/scanner/dashboard-analytics";

const tmpRoot = path.join(os.tmpdir(), "cc-dashboard-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
const fakeClaudeProjectsDir = path.join(tmpRoot, "projects");

const PROJECT_KEY = "C--Users-test-proj";

function assistantLine(ts: string, model: string, usage: { input?: number; output?: number; cache_read?: number; cache_creation?: number }, toolUses: Array<{ name: string; input?: Record<string, unknown> }> = []) {
  const content: unknown[] = [{ type: "text", text: "ok" }];
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

function userText(ts: string, text: string, opts: { isSidechain?: boolean } = {}) {
  const obj: Record<string, unknown> = { type: "user", timestamp: ts, message: { role: "user", content: text } };
  if (opts.isSidechain) obj.isSidechain = true;
  return JSON.stringify(obj);
}

function writeParentSession(id: string, lines: string[]): SessionMeta {
  const projectDir = path.join(fakeClaudeProjectsDir, PROJECT_KEY);
  fs.mkdirSync(projectDir, { recursive: true });
  const filePath = path.join(projectDir, `${id}.jsonl`);
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
  const firstTs = lines[0] ? JSON.parse(lines[0]).timestamp || null : null;
  const lastTs = lines[lines.length - 1] ? JSON.parse(lines[lines.length - 1]).timestamp || firstTs : firstTs;
  return { id, filePath, projectKey: PROJECT_KEY, firstTs, lastTs, firstMessage: "" };
}

function writeSubagent(parentId: string, agentId: string, lines: string[]): void {
  const dir = path.join(fakeClaudeProjectsDir, PROJECT_KEY, parentId, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${agentId}.jsonl`), lines.join("\n") + "\n");
}

beforeAll(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("computeRangeCutoff", () => {
  const now = new Date("2026-04-15T12:00:00Z");

  it("returns null for all", () => {
    expect(computeRangeCutoff("all", now)).toBeNull();
  });

  it("today returns today 00:00", () => {
    const c = computeRangeCutoff("today", now);
    expect(c).not.toBeNull();
    expect(c!.getHours()).toBe(0);
    expect(c!.getMinutes()).toBe(0);
    expect(c!.getDate()).toBe(now.getDate());
  });

  it("7d returns 6 days ago 00:00", () => {
    const c = computeRangeCutoff("7d", now);
    expect(c).not.toBeNull();
    const diffMs = now.getTime() - c!.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it("month returns 1st of the current month", () => {
    const c = computeRangeCutoff("month", now);
    expect(c!.getDate()).toBe(1);
    expect(c!.getMonth()).toBe(now.getMonth());
  });
});

describe("buildDashboardAnalytics", () => {
  it("returns empty shape for no sessions", async () => {
    const r = await buildDashboardAnalytics([], "all", { claudeProjectsDir: fakeClaudeProjectsDir });
    expect(r.header.totalCost).toBe(0);
    expect(r.header.totalTurns).toBe(0);
    expect(r.header.totalSessions).toBe(0);
    expect(r.byProject).toEqual([]);
    expect(r.byActivity).toEqual([]);
    expect(r.byModel).toEqual([]);
    expect(r.coreTools).toEqual([]);
    expect(r.bashCommands).toEqual([]);
    expect(r.mcpServers).toEqual([]);
  });

  it("aggregates a single session with assorted tool uses", async () => {
    const sess = writeParentSession("sess-a", [
      userText("2026-04-15T10:00:00Z", "fix bug"),
      assistantLine("2026-04-15T10:00:05Z", "claude-sonnet-4-6", { input: 1000, output: 500, cache_read: 2000 }, [
        { name: "Read", input: { file_path: "/src/foo.ts" } },
        { name: "Bash", input: { command: "git status" } },
      ]),
      assistantLine("2026-04-15T10:00:15Z", "claude-sonnet-4-6", { input: 500, output: 200 }, [
        { name: "Edit", input: { file_path: "/src/foo.ts" } },
        { name: "mcp__playwright__browser_click", input: { ref: "e1" } },
      ]),
      assistantLine("2026-04-15T10:00:25Z", "claude-sonnet-4-6", { input: 300, output: 100 }, [
        { name: "Bash", input: { command: "npm run test" } },
      ]),
    ]);

    const r = await buildDashboardAnalytics([sess], "all", { claudeProjectsDir: fakeClaudeProjectsDir });

    expect(r.header.totalTurns).toBe(3);
    expect(r.header.totalSessions).toBe(1);
    expect(r.header.activeTokens).toBe(1000 + 500 + 500 + 200 + 300 + 100);
    expect(r.header.cachedTokens).toBe(2000);

    // Core tool counts — Read:1, Bash:2, Edit:1
    const core = Object.fromEntries(r.coreTools.map(t => [t.name, t.count]));
    expect(core["Read"]).toBe(1);
    expect(core["Bash"]).toBe(2);
    expect(core["Edit"]).toBe(1);
    // mcp__playwright is NOT in core tools
    expect(core["Mcp__playwright__browser_click"]).toBeUndefined();

    // MCP server breakdown
    expect(r.mcpServers.length).toBe(1);
    expect(r.mcpServers[0].server).toBe("playwright");
    expect(r.mcpServers[0].count).toBe(1);
    expect(r.mcpServers[0].tools).toContain("browser_click");

    // Bash commands normalized
    const bash = Object.fromEntries(r.bashCommands.map(b => [b.command, b.count]));
    expect(bash["git status"]).toBe(1);
    expect(bash["npm test"]).toBe(1);

    // By Project
    expect(r.byProject.length).toBe(1);
    expect(r.byProject[0].sessions).toBe(1);
    expect(r.byProject[0].turns).toBe(3);
  });

  it("time range excludes sessions outside the cutoff", async () => {
    const old = writeParentSession("old", [
      assistantLine("2025-01-01T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 50 }, [{ name: "Read", input: { file_path: "/x" } }]),
    ]);
    // When asking for "today" on an old session, it should be filtered out.
    const r = await buildDashboardAnalytics([old], "today", { claudeProjectsDir: fakeClaudeProjectsDir, now: new Date("2026-04-15T12:00:00Z") });
    expect(r.header.totalSessions).toBe(0);
    expect(r.header.totalTurns).toBe(0);
  });

  it("walks subagent files and attributes cost to background", async () => {
    const parent = writeParentSession("parent-b", [
      userText("2026-04-15T10:00:00Z", "research something"),
      assistantLine("2026-04-15T10:00:05Z", "claude-opus-4-6", { input: 200, output: 100 }, [
        { name: "Task", input: { subagent_type: "Explore", prompt: "go look" } },
      ]),
    ]);
    writeSubagent("parent-b", "agent-123", [
      userText("2026-04-15T10:00:10Z", "<task>research something</task>", { isSidechain: true }),
      assistantLine("2026-04-15T10:00:15Z", "claude-haiku-4-5", { input: 5000, output: 1000 }),
      assistantLine("2026-04-15T10:00:20Z", "claude-haiku-4-5", { input: 1000, output: 500 }),
    ]);

    const r = await buildDashboardAnalytics([parent], "all", { claudeProjectsDir: fakeClaudeProjectsDir });

    expect(r.background.subagentSessions).toBe(1);
    expect(r.background.subagentTurns).toBe(2);
    expect(r.background.subagentTokens).toBe(5000 + 1000 + 1000 + 500);
    expect(r.background.subagentCost).toBeGreaterThan(0);
    // Subagent_type "Explore" should show in subagentTypes
    expect(r.background.subagentTypes.length).toBe(1);
    expect(r.background.subagentTypes[0].subagentType).toBe("Explore");
    expect(r.background.subagentTypes[0].count).toBe(1);
    // Parent turns + subagent turns all counted in header totalTurns? Parent only — background turns are separate.
    expect(r.header.totalTurns).toBe(1);
    // But subagent tokens DO land in activeTokens so the header spend reflects reality.
    expect(r.header.activeTokens).toBe(200 + 100 + 5000 + 1000 + 1000 + 500);
  });

  it("bash command normalization splits compound commands", async () => {
    const sess = writeParentSession("sess-c", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 10, output: 5 }, [
        { name: "Bash", input: { command: "git add -A && git commit -m 'x'" } },
      ]),
    ]);
    const r = await buildDashboardAnalytics([sess], "all", { claudeProjectsDir: fakeClaudeProjectsDir });
    const bash = Object.fromEntries(r.bashCommands.map(b => [b.command, b.count]));
    expect(bash["git add"]).toBe(1);
    expect(bash["git commit"]).toBe(1);
  });

  it("by-model groups distinct full model strings", async () => {
    const sess = writeParentSession("sess-d", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 50 }),
      assistantLine("2026-04-15T10:00:10Z", "claude-opus-4-6", { input: 50, output: 25 }),
    ]);
    const r = await buildDashboardAnalytics([sess], "all", { claudeProjectsDir: fakeClaudeProjectsDir });
    expect(r.byModel.length).toBe(2);
    const sonnet = r.byModel.find(m => m.model === "claude-sonnet-4-6")!;
    const opus = r.byModel.find(m => m.model === "claude-opus-4-6")!;
    expect(sonnet.family).toBe("sonnet");
    expect(opus.family).toBe("opus");
  });

  it("cache hit rate appears in header", async () => {
    const sess = writeParentSession("sess-e", [
      assistantLine("2026-04-15T10:00:00Z", "claude-sonnet-4-6", { input: 100, output: 100, cache_read: 800 }),
    ]);
    const r = await buildDashboardAnalytics([sess], "all", { claudeProjectsDir: fakeClaudeProjectsDir });
    // active = 200, cached = 800 → hit rate = 800/1000 = 80%
    expect(r.header.cacheHitRatePct).toBeCloseTo(80, 1);
  });
});
