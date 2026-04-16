import fs from "fs";
import path from "path";
import { getPricing, computeCost } from "./pricing";
import { extractTurns, classifyOrigin, type RawToolUse } from "./turn-extractor";
import { classifyTurn, buildBurnTurns, BURN_CATEGORIES, type BurnCategory } from "./burn-analytics";
import { decodeProjectKey } from "./utils";

export type TimeRange = "today" | "7d" | "30d" | "month" | "all";

export interface DashboardHeader {
  range: TimeRange;
  rangeLabel: string;
  rangeStartIso: string | null;
  totalCost: number;
  activeTokens: number;
  cachedTokens: number;
  totalTurns: number;
  totalSessions: number;
  cacheHitRatePct: number;
}

export interface DailyBar {
  date: string;
  cost: number;
  activeTokens: number;
  cachedTokens: number;
  burnedCost: number;
  sessions: number;
}

export interface ProjectRow {
  project: string;
  projectLabel: string;
  cost: number;
  sessions: number;
  turns: number;
}

export interface ActivityRow {
  category: BurnCategory;
  cost: number;
  turns: number;
  tokens: number;
  oneShotRatePct: number;
  burnedCost: number;
}

export interface ModelRow {
  model: string;
  family: "opus" | "sonnet" | "haiku" | "other";
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  turns: number;
}

export interface ToolCountRow {
  name: string;
  count: number;
}

export interface BashCommandRow {
  command: string;
  count: number;
}

export interface McpServerRow {
  server: string;
  count: number;
  tools: string[];
}

export interface SubagentTypeRow {
  subagentType: string;
  count: number;
}

export interface BackgroundActivity {
  subagentSessions: number;
  subagentTurns: number;
  subagentCost: number;
  subagentTokens: number;
  hookSessions: number;
  hookCost: number;
  subagentTypes: SubagentTypeRow[];
}

export interface DashboardAnalytics {
  header: DashboardHeader;
  byDay: DailyBar[];
  byProject: ProjectRow[];
  byActivity: ActivityRow[];
  byModel: ModelRow[];
  coreTools: ToolCountRow[];
  bashCommands: BashCommandRow[];
  mcpServers: McpServerRow[];
  background: BackgroundActivity;
  burnPct: number;
  oneShotRatePct: number;
  durationMs: number;
}

export interface SessionMeta {
  id: string;
  filePath: string;
  projectKey: string;
  firstTs: string | null;
  lastTs: string | null;
  firstMessage?: string;
}

// ---- Range handling ----

const RANGE_LABELS: Record<TimeRange, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  month: "This Month",
  all: "All Time",
};

export function computeRangeCutoff(range: TimeRange, now: Date = new Date()): Date | null {
  if (range === "all") return null;
  const d = new Date(now);
  if (range === "today") {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (range === "7d") {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 6);
    return d;
  }
  if (range === "30d") {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 29);
    return d;
  }
  if (range === "month") {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  return null;
}

// ---- Tool / bash / MCP normalization ----

// Display names keyed by lowercase. Anything not here keeps its original casing.
const CORE_TOOL_DISPLAY: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  multiedit: "MultiEdit",
  grep: "Grep",
  glob: "Glob",
  task: "Task",
  agent: "Agent",
  skill: "Skill",
  ls: "LS",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  notebookedit: "NotebookEdit",
  taskcreate: "TaskCreate",
  taskupdate: "TaskUpdate",
  taskget: "TaskGet",
  tasklist: "TaskList",
  taskstop: "TaskStop",
  taskoutput: "TaskOutput",
  monitor: "Monitor",
  schedulewakeup: "ScheduleWakeup",
  exitplanmode: "ExitPlanMode",
  enterplanmode: "EnterPlanMode",
  exitworktree: "ExitWorktree",
  enterworktree: "EnterWorktree",
  toolsearch: "ToolSearch",
  askuserquestion: "AskUserQuestion",
  remotetrigger: "RemoteTrigger",
  croncreate: "CronCreate",
  cronlist: "CronList",
  crondelete: "CronDelete",
};

function normalizeCoreToolName(name: string): string | null {
  if (!name) return null;
  if (name.startsWith("mcp__")) return null;
  const lower = name.toLowerCase();
  return CORE_TOOL_DISPLAY[lower] || name;
}

function extractMcpServer(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const parts = toolName.slice(5).split("__");
  if (parts.length < 2) return null;
  return { server: parts[0], tool: parts.slice(1).join("__") };
}

function normalizeBashCommand(raw: string): string[] {
  if (!raw) return [];
  const cmd = raw.trim().toLowerCase();
  if (!cmd) return [];
  // Split compound commands on &&, ;, ||, |
  const segments = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(s => s.length > 0);
  const results: string[] = [];
  for (const seg of segments) {
    const tokens = seg.split(/\s+/);
    if (tokens.length === 0) continue;
    const first = tokens[0];
    // "npm run test" -> "npm test", "pnpm run dev" -> "pnpm dev", "yarn dev" stays
    if ((first === "npm" || first === "pnpm" || first === "yarn") && tokens.length >= 2) {
      let arg = tokens[1];
      if (arg === "run" && tokens.length >= 3) arg = tokens[2];
      results.push(`${first} ${arg}`.slice(0, 30));
      continue;
    }
    if ((first === "git" || first === "gh" || first === "docker") && tokens.length >= 2) {
      results.push(`${first} ${tokens[1]}`.slice(0, 30));
      continue;
    }
    results.push(first.slice(0, 30));
  }
  return results;
}

// ---- Model family + display ----

function getModelFamily(model: string): "opus" | "sonnet" | "haiku" | "other" {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return "opus";
  if (lower.includes("haiku")) return "haiku";
  if (lower.includes("sonnet")) return "sonnet";
  return "other";
}

// ---- Subagent discovery ----

function findSubagentFiles(projectKey: string, parentSessionId: string, claudeProjectsDir: string): string[] {
  const dir = path.join(claudeProjectsDir, projectKey, parentSessionId, "subagents");
  try {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir);
    return entries
      .filter(f => f.endsWith(".jsonl") && f.startsWith("agent-"))
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

// ---- Main build ----

export async function buildDashboardAnalytics(
  sessions: SessionMeta[],
  range: TimeRange,
  opts: { claudeProjectsDir: string; now?: Date } = { claudeProjectsDir: path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "projects") }
): Promise<DashboardAnalytics> {
  const start = performance.now();
  const now = opts.now || new Date();
  const cutoff = computeRangeCutoff(range, now);
  const cutoffMs = cutoff ? cutoff.getTime() : 0;

  // Pre-filter sessions: keep those whose window overlaps the range.
  const candidates = sessions.filter(s => {
    if (!cutoff) return true;
    const lastMs = s.lastTs ? Date.parse(s.lastTs) : 0;
    return lastMs >= cutoffMs;
  });

  // Daily buckets — seed based on range.
  const dayKeys: string[] = [];
  if (range === "all") {
    // Seed all days we'll actually see from sessions. Start empty; fill as we go.
  } else {
    const d = new Date(cutoff!);
    const endDay = new Date(now);
    endDay.setHours(0, 0, 0, 0);
    while (d.getTime() <= endDay.getTime()) {
      dayKeys.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  }
  const dailyMap: Record<string, DailyBar> = {};
  for (const k of dayKeys) {
    dailyMap[k] = { date: k, cost: 0, activeTokens: 0, cachedTokens: 0, burnedCost: 0, sessions: 0 };
  }

  const projectMap = new Map<string, { cost: number; sessions: Set<string>; turns: number }>();
  const modelMap = new Map<string, { family: "opus" | "sonnet" | "haiku" | "other"; cost: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; turns: number }>();
  const activityMap = new Map<BurnCategory, { cost: number; turns: number; tokens: number; burnedCost: number; burnedTurns: number }>();
  for (const c of BURN_CATEGORIES) activityMap.set(c, { cost: 0, turns: 0, tokens: 0, burnedCost: 0, burnedTurns: 0 });
  const coreToolCounts = new Map<string, number>();
  const bashCmdCounts = new Map<string, number>();
  const mcpServerMap = new Map<string, { count: number; tools: Set<string> }>();
  const subagentTypeCounts = new Map<string, number>();

  let totalCost = 0, activeTokens = 0, cachedTokens = 0, totalTurns = 0;
  let burnedCost = 0, burnedTurns = 0;
  let scannedSessions = 0;
  const daysSeenInSession = new Set<string>();

  // Background tracking
  let subagentSessions = 0, subagentTurns = 0, subagentCost = 0, subagentTokens = 0;
  let hookSessions = 0, hookCost = 0;

  const BATCH_SIZE = 20;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (sess) => {
      const parent = await extractTurns(sess.filePath);
      const subagentFiles = findSubagentFiles(sess.projectKey, sess.id, opts.claudeProjectsDir);
      const subagentResults = await Promise.all(subagentFiles.map(fp => extractTurns(fp)));
      return { sess, parent, subagentResults };
    }));

    for (const { sess, parent, subagentResults } of results) {
      const projectPath = decodeProjectKey(sess.projectKey);
      let sessionHadTurnInRange = false;
      daysSeenInSession.clear();

      // Parent session
      const origin = classifyOrigin(parent.firstUserMessage);
      if (origin === "hook") {
        hookSessions++;
      }

      const burn = buildBurnTurns(parent.turns, parent.errors);
      for (let ti = 0; ti < parent.turns.length; ti++) {
        const t = parent.turns[ti];
        const b = burn[ti];
        const ms = Date.parse(t.ts);
        if (cutoff && ms < cutoffMs) continue;
        sessionHadTurnInRange = true;

        const active = t.inputTokens + t.outputTokens + t.cacheCreationTokens;
        const cost = computeCost(getPricing(t.model), t.inputTokens, t.outputTokens, t.cacheReadTokens, t.cacheCreationTokens);

        totalCost += cost;
        activeTokens += active;
        cachedTokens += t.cacheReadTokens;
        totalTurns++;
        if (b.burned) { burnedCost += cost; burnedTurns++; }

        if (origin === "hook") hookCost += cost;

        const dateKey = t.ts.slice(0, 10);
        daysSeenInSession.add(dateKey);
        if (!dailyMap[dateKey]) {
          if (range === "all") dailyMap[dateKey] = { date: dateKey, cost: 0, activeTokens: 0, cachedTokens: 0, burnedCost: 0, sessions: 0 };
        }
        if (dailyMap[dateKey]) {
          dailyMap[dateKey].cost += cost;
          dailyMap[dateKey].activeTokens += active;
          dailyMap[dateKey].cachedTokens += t.cacheReadTokens;
          if (b.burned) dailyMap[dateKey].burnedCost += cost;
        }

        // Project
        const pm = projectMap.get(projectPath) || { cost: 0, sessions: new Set<string>(), turns: 0 };
        pm.cost += cost;
        pm.sessions.add(sess.id);
        pm.turns++;
        projectMap.set(projectPath, pm);

        // Model
        const fam = getModelFamily(t.model);
        const mm = modelMap.get(t.model) || { family: fam, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, turns: 0 };
        mm.cost += cost;
        mm.inputTokens += t.inputTokens;
        mm.outputTokens += t.outputTokens;
        mm.cacheReadTokens += t.cacheReadTokens;
        mm.turns++;
        modelMap.set(t.model, mm);

        // Activity
        const cat = classifyTurn(t.toolUses as RawToolUse[]);
        const am = activityMap.get(cat)!;
        am.cost += cost;
        am.turns++;
        am.tokens += active;
        if (b.burned) { am.burnedCost += cost; am.burnedTurns++; }

        // Tool / bash / MCP extraction
        for (const tu of t.toolUses) {
          const mcp = extractMcpServer(tu.name);
          if (mcp) {
            const existing = mcpServerMap.get(mcp.server) || { count: 0, tools: new Set<string>() };
            existing.count++;
            existing.tools.add(mcp.tool);
            mcpServerMap.set(mcp.server, existing);
          } else {
            const display = normalizeCoreToolName(tu.name);
            if (display) coreToolCounts.set(display, (coreToolCounts.get(display) || 0) + 1);
            if (tu.name.toLowerCase() === "bash") {
              const cmd = String(tu.input?.command || "");
              const normalized = normalizeBashCommand(cmd);
              for (const n of normalized) {
                bashCmdCounts.set(n, (bashCmdCounts.get(n) || 0) + 1);
              }
            }
            if (tu.name.toLowerCase() === "task" || tu.name.toLowerCase() === "agent") {
              const st = String(tu.input?.subagent_type || "").trim();
              if (st) subagentTypeCounts.set(st, (subagentTypeCounts.get(st) || 0) + 1);
            }
          }
        }
      }

      if (sessionHadTurnInRange) {
        scannedSessions++;
        const daysArr = Array.from(daysSeenInSession);
        for (const k of daysArr) {
          if (dailyMap[k]) dailyMap[k].sessions++;
        }
      }

      // Subagent files — tokens attributed to background only, not to parent's category totals.
      for (const sub of subagentResults) {
        let hadTurnInRange = false;
        for (const t of sub.turns) {
          const ms = Date.parse(t.ts);
          if (cutoff && ms < cutoffMs) continue;
          hadTurnInRange = true;
          const active = t.inputTokens + t.outputTokens + t.cacheCreationTokens;
          const cost = computeCost(getPricing(t.model), t.inputTokens, t.outputTokens, t.cacheReadTokens, t.cacheCreationTokens);
          subagentTurns++;
          subagentCost += cost;
          subagentTokens += active;
          totalCost += cost;
          activeTokens += active;
          cachedTokens += t.cacheReadTokens;
          // Subagents also contribute to model + daily so the header totals honestly include their spend.
          const fam = getModelFamily(t.model);
          const mm = modelMap.get(t.model) || { family: fam, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, turns: 0 };
          mm.cost += cost;
          mm.inputTokens += t.inputTokens;
          mm.outputTokens += t.outputTokens;
          mm.cacheReadTokens += t.cacheReadTokens;
          mm.turns++;
          modelMap.set(t.model, mm);
          const dateKey = t.ts.slice(0, 10);
          if (!dailyMap[dateKey] && range === "all") {
            dailyMap[dateKey] = { date: dateKey, cost: 0, activeTokens: 0, cachedTokens: 0, burnedCost: 0, sessions: 0 };
          }
          if (dailyMap[dateKey]) {
            dailyMap[dateKey].cost += cost;
            dailyMap[dateKey].activeTokens += active;
            dailyMap[dateKey].cachedTokens += t.cacheReadTokens;
          }
        }
        if (hadTurnInRange) subagentSessions++;
      }
    }
  }

  // Compose outputs
  const byDay = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      cost: Math.round(d.cost * 10000) / 10000,
      burnedCost: Math.round(d.burnedCost * 10000) / 10000,
    }));

  const byProject: ProjectRow[] = Array.from(projectMap.entries())
    .map(([p, v]) => ({
      project: p,
      projectLabel: lastPathSegment(p),
      cost: Math.round(v.cost * 10000) / 10000,
      sessions: v.sessions.size,
      turns: v.turns,
    }))
    .sort((a, b) => b.cost - a.cost);

  const byActivity: ActivityRow[] = BURN_CATEGORIES.map(c => {
    const v = activityMap.get(c)!;
    const one = v.turns === 0 ? 100 : Math.round(((v.turns - v.burnedTurns) / v.turns) * 1000) / 10;
    return {
      category: c,
      cost: Math.round(v.cost * 10000) / 10000,
      turns: v.turns,
      tokens: v.tokens,
      oneShotRatePct: one,
      burnedCost: Math.round(v.burnedCost * 10000) / 10000,
    };
  }).filter(a => a.turns > 0)
    .sort((a, b) => b.cost - a.cost);

  const byModel: ModelRow[] = Array.from(modelMap.entries())
    .map(([m, v]) => ({
      model: m,
      family: v.family,
      cost: Math.round(v.cost * 10000) / 10000,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      cacheReadTokens: v.cacheReadTokens,
      turns: v.turns,
    }))
    .sort((a, b) => b.cost - a.cost);

  const coreTools: ToolCountRow[] = Array.from(coreToolCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const bashCommands: BashCommandRow[] = Array.from(bashCmdCounts.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const mcpServers: McpServerRow[] = Array.from(mcpServerMap.entries())
    .map(([server, v]) => ({ server, count: v.count, tools: Array.from(v.tools).sort() }))
    .sort((a, b) => b.count - a.count);

  const subagentTypes: SubagentTypeRow[] = Array.from(subagentTypeCounts.entries())
    .map(([subagentType, count]) => ({ subagentType, count }))
    .sort((a, b) => b.count - a.count);

  const background: BackgroundActivity = {
    subagentSessions,
    subagentTurns,
    subagentCost: Math.round(subagentCost * 10000) / 10000,
    subagentTokens,
    hookSessions,
    hookCost: Math.round(hookCost * 10000) / 10000,
    subagentTypes,
  };

  const activeTotal = activeTokens + cachedTokens;
  const cacheHitRatePct = activeTotal === 0 ? 0 : Math.round((cachedTokens / activeTotal) * 1000) / 10;
  const burnPct = activeTokens === 0 ? 0 : Math.round((burnedCost / Math.max(totalCost, 0.0001)) * 1000) / 10;
  const oneShotRatePct = totalTurns === 0 ? 100 : Math.round(((totalTurns - burnedTurns) / totalTurns) * 1000) / 10;

  const header: DashboardHeader = {
    range,
    rangeLabel: RANGE_LABELS[range],
    rangeStartIso: cutoff ? cutoff.toISOString() : null,
    totalCost: Math.round(totalCost * 10000) / 10000,
    activeTokens,
    cachedTokens,
    totalTurns,
    totalSessions: scannedSessions,
    cacheHitRatePct,
  };

  return {
    header,
    byDay,
    byProject,
    byActivity,
    byModel,
    coreTools,
    bashCommands,
    mcpServers,
    background,
    burnPct,
    oneShotRatePct,
    durationMs: Math.round(performance.now() - start),
  };
}

function lastPathSegment(p: string): string {
  if (!p) return "unknown";
  const normalized = p.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || p;
}
