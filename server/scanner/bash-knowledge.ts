import fs from "fs";
import type { SessionData, BashCommand, BashKnowledgeBase, BashSearchResult } from "@shared/types";

const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ["docker", /docker|docker-compose|docker compose/i],
  ["git", /^git\s/i],
  ["build", /npm|npx|vitest|tsc|webpack|vite/i],
  ["network", /curl|wget|ssh|scp|ping|netstat/i],
  ["system", /powershell|Start-Process|taskkill|kill|ps\s|systemctl/i],
  ["database", /pg_dump|pg_restore|psql|sqlite/i],
  ["file", /^(ls|cat|head|tail|find|mkdir|rm|cp|mv|chmod)\s/i],
];

function categorize(command: string): string {
  for (const [cat, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(command)) return cat;
  }
  return "other";
}

/** Extract all Bash commands from a session JSONL */
function extractBashCommands(session: SessionData): BashCommand[] {
  const commands: BashCommand[] = [];
  try {
    const content = fs.readFileSync(session.filePath, "utf-8");
    let pos = 0;
    // Collect tool_use blocks, then match with tool_results
    const toolUses: Array<{ id: string; command: string; description: string; ts: string }> = [];
    const toolResults: Map<string, { succeeded: boolean; errorOutput?: string }> = new Map();

    while (pos < content.length) {
      const nextNewline = content.indexOf("\n", pos);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const trimmed = content.slice(pos, lineEnd).trim();
      pos = lineEnd + 1;
      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed);
        if (record.type === "assistant" && Array.isArray(record.message?.content)) {
          for (const item of record.message.content) {
            if (item?.type === "tool_use" && (item.name === "Bash" || item.name === "bash")) {
              const input = item.input as Record<string, unknown>;
              const cmd = String(input?.command || "").trim();
              if (cmd) {
                toolUses.push({
                  id: item.id || "",
                  command: cmd,
                  description: String(input?.description || ""),
                  ts: record.timestamp || "",
                });
              }
            }
          }
        } else if (record.type === "user" && Array.isArray(record.message?.content)) {
          for (const item of record.message.content) {
            if (item?.type === "tool_result" && item.tool_use_id) {
              const errorText = typeof item.content === "string" ? item.content : "";
              toolResults.set(item.tool_use_id, {
                succeeded: !item.is_error,
                errorOutput: item.is_error ? errorText.slice(0, 200) : undefined,
              });
            }
          }
        }
      } catch {}
    }

    // Match tool_use with tool_result
    for (const tu of toolUses) {
      const result = toolResults.get(tu.id);
      commands.push({
        command: tu.command.slice(0, 500),
        description: tu.description.slice(0, 200),
        category: categorize(tu.command),
        succeeded: result?.succeeded ?? true,
        errorOutput: result?.errorOutput,
        timestamp: tu.ts,
        sessionId: session.id,
        projectKey: session.projectKey,
      });
    }
  } catch {}
  return commands;
}

// Cache
let cached: BashKnowledgeBase | null = null;
let allCommands: BashCommand[] = [];
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

function runScan(sessions: SessionData[]): void {
  const start = performance.now();
  allCommands = [];

  for (const s of sessions) {
    if (s.isEmpty) continue;
    allCommands.push(...extractBashCommands(s));
  }

  // Compute stats
  const byCategory: Record<string, { count: number; successes: number }> = {};
  const cmdFreq: Map<string, { count: number; successes: number; lastUsed: string; lastError: string }> = new Map();

  for (const cmd of allCommands) {
    // Category stats
    if (!byCategory[cmd.category]) byCategory[cmd.category] = { count: 0, successes: 0 };
    byCategory[cmd.category].count++;
    if (cmd.succeeded) byCategory[cmd.category].successes++;

    // Normalize command for frequency (strip arguments that change)
    const normalized = cmd.command.split("\n")[0].slice(0, 100);
    const existing = cmdFreq.get(normalized) || { count: 0, successes: 0, lastUsed: "", lastError: "" };
    existing.count++;
    if (cmd.succeeded) existing.successes++;
    if (cmd.timestamp > existing.lastUsed) existing.lastUsed = cmd.timestamp;
    if (!cmd.succeeded && cmd.errorOutput) existing.lastError = cmd.errorOutput;
    cmdFreq.set(normalized, existing);
  }

  // Build result
  const byCategoryResult: Record<string, { count: number; successRate: number }> = {};
  for (const [cat, data] of Object.entries(byCategory)) {
    byCategoryResult[cat] = { count: data.count, successRate: data.count > 0 ? Math.round(data.successes / data.count * 100) : 0 };
  }

  const frequent: Array<{ command: string; count: number; successRate: number; lastUsed: string }> = [];
  const failures: Array<{ command: string; failCount: number; lastError: string }> = [];

  cmdFreq.forEach((data, cmd) => {
    frequent.push({ command: cmd, count: data.count, successRate: data.count > 0 ? Math.round(data.successes / data.count * 100) : 0, lastUsed: data.lastUsed });
    const failCount = data.count - data.successes;
    if (failCount > 0) failures.push({ command: cmd, failCount, lastError: data.lastError });
  });

  frequent.sort((a, b) => b.count - a.count);
  failures.sort((a, b) => b.failCount - a.failCount);

  cached = {
    uniqueCommands: cmdFreq.size,
    totalExecutions: allCommands.length,
    byCategory: byCategoryResult,
    frequentCommands: frequent.slice(0, 30),
    failureHotspots: failures.slice(0, 20),
    durationMs: Math.round(performance.now() - start),
  };
  cachedAt = Date.now();
}

export function getBashKnowledgeBase(sessions: SessionData[]): BashKnowledgeBase {
  if (!cached || Date.now() - cachedAt > CACHE_TTL) runScan(sessions);
  return cached!;
}

export function searchBashCommands(sessions: SessionData[], query: string): BashSearchResult {
  if (!cached || Date.now() - cachedAt > CACHE_TTL) runScan(sessions);
  const q = query.toLowerCase();
  const matches = allCommands.filter(c =>
    c.command.toLowerCase().includes(q) ||
    c.description.toLowerCase().includes(q) ||
    (c.errorOutput || "").toLowerCase().includes(q)
  );
  return { matches: matches.slice(0, 50), totalMatches: matches.length };
}
