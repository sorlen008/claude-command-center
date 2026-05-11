import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Force a tmp data dir so test cache writes don't pollute ~/.claude-command-center
const tmpData = path.join(os.tmpdir(), "cc-infer-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
process.env.COMMAND_CENTER_DATA = tmpData;

import { getInferredProject, warmInferenceCache, _resetCacheForTests } from "../server/scanner/project-inference";
import { HOME } from "../server/scanner/utils";

const tmpSessions = path.join(os.tmpdir(), "cc-infer-sessions-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
fs.mkdirSync(tmpSessions, { recursive: true });

function assistantToolUse(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "tu_" + Math.random().toString(36).slice(2), name, input }],
    },
  });
}

function writeSession(id: string, lines: string[]): string {
  const p = path.join(tmpSessions, `${id}.jsonl`);
  fs.writeFileSync(p, lines.join("\n"), "utf-8");
  return p;
}

beforeEach(() => {
  _resetCacheForTests();
});

afterAll(() => {
  try { fs.rmSync(tmpSessions, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("project-inference", () => {
  it("classifies a session that mostly edits files in one project", async () => {
    const id = "test-dominant";
    const lines = [
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/app/server/routes.ts` }),
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/app/server/db.ts` }),
      assistantToolUse("Write", { file_path: `${HOME}/acme-app/app/client/foo.tsx` }),
      assistantToolUse("Read", { file_path: `${HOME}/acme-app/README.md` }),
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    const result = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    expect(result.inferredProject).toBe("acme-app");
    expect(result.stats?.confidence).toBe(1);
    expect(result.stats?.edits).toBe(3);
  });

  it("returns null when no single project dominates (mixed work)", async () => {
    const id = "test-mixed";
    const lines = [
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/a.ts` }),
      assistantToolUse("Edit", { file_path: `${HOME}/dataservice/b.py` }),
      assistantToolUse("Edit", { file_path: `${HOME}/utilkit/c.py` }),
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    const result = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    // 1/3 share each — below the 0.6 threshold
    expect(result.inferredProject).toBeNull();
    // Stats are still computed for display, but the top doesn't pass the gate
    expect(result.stats?.breakdown.length).toBeGreaterThan(0);
  });

  it("returns null when there's too little file activity", async () => {
    const id = "test-too-few";
    const lines = [
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/a.ts` }),
      assistantToolUse("Read", { file_path: `${HOME}/acme-app/b.ts` }),
      // 2 file ops total — below MIN_OPS=3
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    const result = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    expect(result.inferredProject).toBeNull();
  });

  it("buckets .claude/* edits as 'system'", async () => {
    const id = "test-system";
    const lines = [
      assistantToolUse("Edit", { file_path: `${HOME}/.claude/skills/finish/SKILL.md` }),
      assistantToolUse("Edit", { file_path: `${HOME}/.claude/skills/cc-release/SKILL.md` }),
      assistantToolUse("Edit", { file_path: `${HOME}/.claude/settings.json` }),
      assistantToolUse("Read", { file_path: `${HOME}/.claude/CLAUDE.md` }),
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    const result = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    expect(result.inferredProject).toBe("system");
  });

  it("ignores top-level OS-noise dirs like Downloads / OneDrive", async () => {
    const id = "test-ignore";
    const lines = [
      assistantToolUse("Read", { file_path: `${HOME}/Downloads/something.pdf` }),
      assistantToolUse("Read", { file_path: `${HOME}/OneDrive/Documents/notes.txt` }),
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/real.ts` }),
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/work.ts` }),
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/here.ts` }),
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    const result = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    // Downloads/OneDrive ignored; only acme-app counts
    expect(result.inferredProject).toBe("acme-app");
  });

  it("returns null for a session with no tool calls at all", async () => {
    const id = "test-empty";
    const lines = [
      JSON.stringify({ type: "user", message: { role: "user", content: "Just chatting." } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } }),
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    const result = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    expect(result.inferredProject).toBeNull();
  });

  it("caches by fileSize — second call without changing the file is a hit", async () => {
    const id = "test-cache";
    const lines = [
      assistantToolUse("Edit", { file_path: `${HOME}/dataservice/a.py` }),
      assistantToolUse("Edit", { file_path: `${HOME}/dataservice/b.py` }),
      assistantToolUse("Edit", { file_path: `${HOME}/dataservice/c.py` }),
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    // Synchronous read of the warmed entry
    const r1 = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    expect(r1.inferredProject).toBe("dataservice");
    // Calling again with same fileSize returns the same answer immediately
    const r2 = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    expect(r2.inferredProject).toBe("dataservice");
  });

  it("weighs writes more than reads — heavy writes in A beat scattered reads in B", async () => {
    const id = "test-weights";
    // 4 writes to acme-app (weight 12) vs. 2 reads to dataservice (weight 2)
    // acme-app share = 12/14 = 86%, well above 60% threshold.
    const lines = [
      assistantToolUse("Write", { file_path: `${HOME}/acme-app/a.ts` }),
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/b.ts` }),
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/c.ts` }),
      assistantToolUse("Edit", { file_path: `${HOME}/acme-app/d.ts` }),
      assistantToolUse("Read", { file_path: `${HOME}/dataservice/x.py` }),
      assistantToolUse("Read", { file_path: `${HOME}/dataservice/y.py` }),
    ];
    const p = writeSession(id, lines);
    const stat = fs.statSync(p);
    await warmInferenceCache([{ id, filePath: p.replace(/\\/g, "/"), sizeBytes: stat.size }]);
    const result = getInferredProject(id, p.replace(/\\/g, "/"), stat.size);
    expect(result.inferredProject).toBe("acme-app");
    expect(result.stats?.confidence).toBeGreaterThan(0.8);
  });
});
