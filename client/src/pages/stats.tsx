import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Bot,
  MessageSquare,
  HardDrive,
  FolderOpen,
  DollarSign,
  TrendingUp,
  Zap,
  AlertTriangle,
  Server,
  Cpu,
  Shield,
  Flame,
  Target,
  Repeat,
} from "lucide-react";
import { formatBytes, formatDayLabel, isToday, downloadCSV } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, AlertCircle } from "lucide-react";
import { InfoTooltip } from "@/components/info-tooltip";

// ---- Types ----

interface StatsOverview {
  sessionsPerDay: { date: string; count: number }[];
  topProjects: { name: string; sessions: number; size: number }[];
  agentTypeDistribution: Record<string, number>;
  modelDistribution: Record<string, number>;
  totalTokensEstimate: number;
  totalSessions: number;
  totalAgentExecutions: number;
  averageSessionSize: number;
}

interface DailyCost {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

interface ModelBreakdown {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  sessions: number;
}

interface ProjectBreakdown {
  project: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  sessions: number;
}

interface ErrorEntry {
  type: string;
  count: number;
  lastSeen: string;
  example: string;
}

interface CostAnalytics {
  dailyCosts: DailyCost[];
  byModel: Record<string, ModelBreakdown>;
  byProject: ProjectBreakdown[];
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  planLimits: {
    pro: { limit: number; label: string };
    max5x: { limit: number; label: string };
    max20x: { limit: number; label: string };
  };
  errors: ErrorEntry[];
}

// ---- Utilities ----

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return n.toString();
}

function formatCost(n: number): string {
  return "$" + n.toFixed(2);
}

function lastPathSegment(fullPath: string): string {
  if (!fullPath || fullPath === "(no project)") return fullPath || "Unknown";
  const normalized = fullPath.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || fullPath;
}

const distributionColors: Record<string, string> = {
  Explore: "bg-blue-500",
  Plan: "bg-purple-500",
  "general-purpose": "bg-emerald-500",
  Opus: "bg-orange-500",
  Sonnet: "bg-blue-500",
  Haiku: "bg-green-500",
};

function getDistributionColor(key: string): string {
  for (const [pattern, color] of Object.entries(distributionColors)) {
    if (key.toLowerCase().includes(pattern.toLowerCase())) return color;
  }
  const fallbacks = ["bg-cyan-500", "bg-pink-500", "bg-amber-500", "bg-indigo-500", "bg-teal-500"];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return fallbacks[Math.abs(hash) % fallbacks.length];
}

const MODEL_COLORS: Record<string, string> = {
  opus: "bg-orange-500",
  sonnet: "bg-blue-500",
  haiku: "bg-green-500",
};

function getModelColor(model: string): string {
  const lower = model.toLowerCase();
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return color;
  }
  const fallbacks = ["bg-cyan-500", "bg-pink-500", "bg-amber-500", "bg-indigo-500"];
  let hash = 0;
  for (let i = 0; i < model.length; i++) hash = (hash * 31 + model.charCodeAt(i)) | 0;
  return fallbacks[Math.abs(hash) % fallbacks.length];
}

function errorHelpFor(type: string): React.ReactNode | null {
  switch (type) {
    case "tool_error":
      return <><p><b>What it is:</b> a bash command or tool call returned a non-zero exit code. Most common cause: Claude ran a script that didn't exist, a file that wasn't there, or a command that hit an error mid-execution.</p><p><b>Your job:</b> glance at the example — if it's the same script failing repeatedly, that script probably needs fixing or Claude is being asked to run something it shouldn't. If it's scattered one-offs, safe to ignore.</p></>;
    case "compilation":
      return <><p><b>What it is:</b> TypeScript, Python, or other compiler/syntax errors. <code>tsc</code>, <code>SyntaxError</code>, <code>cannot find module</code>, etc.</p><p><b>Your job:</b> usually none — Claude iterates until the code compiles. High counts here often mean active development, not a problem. If a specific error repeats after Claude claimed it was fixed, that's worth investigating.</p></>;
    case "test_failure":
      return <><p><b>What it is:</b> a test ran and failed. <code>pytest</code>, <code>vitest</code>, <code>jest</code>, assertion mismatches.</p><p><b>Your job:</b> usually none — Claude's normal loop is write code, run tests, fix the failure. Worth reviewing if the same test keeps failing across many sessions (possibly a flaky test or a wrong assumption).</p></>;
    case "permission":
      return <><p><b>What it is:</b> Claude tried to read, write, or execute something the OS refused. <code>EACCES</code>, <code>Permission denied</code>.</p><p><b>Your job:</b> if Claude keeps hitting the same path, grant it. Edit <code>.claude/settings.local.json</code> and add the pattern to <code>permissions.allow</code>, or invoke Claude with bypass mode for that session.</p></>;
    case "network":
      return <><p><b>What it is:</b> a fetch, curl, or webhook call failed due to DNS, connection refused, or timeout.</p><p><b>Your job:</b> check whether the target service is actually running. Common causes: local dev server crashed, Cloudflare tunnel URL changed, VPN disconnected, external API rate-limiting you.</p></>;
    case "other":
      return <><p><b>What it is:</b> an error the classifier couldn't bucket — often an exit-code-1 from a tool, a file-size limit hit, a malformed input, or a quirk of a specific tool.</p><p><b>Your job:</b> skim the example. If it's a repeating "File content exceeds maximum allowed size" message, you can split the file or use <code>offset</code>/<code>limit</code>. Most "other" errors are isolated and safe to ignore.</p></>;
    default:
      return null;
  }
}

const ERROR_STYLES: Record<string, { bg: string; border: string; text: string; icon: typeof AlertTriangle }> = {
  tool_error: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", icon: AlertTriangle },
  compilation: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", icon: Cpu },
  test_failure: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", icon: AlertTriangle },
  permission: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", icon: Shield },
  network: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400", icon: Server },
  other: { bg: "bg-zinc-500/10", border: "border-zinc-500/30", text: "text-zinc-400", icon: AlertTriangle },
};

// ---- Dashboard types ----

type TimeRange = "today" | "7d" | "30d" | "month" | "all";

interface DashboardHeader {
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

interface DailyBar {
  date: string;
  cost: number;
  activeTokens: number;
  cachedTokens: number;
  burnedCost: number;
  sessions: number;
}

interface ProjectRow {
  project: string;
  projectLabel: string;
  cost: number;
  sessions: number;
  turns: number;
}

interface ActivityRow {
  category: string;
  cost: number;
  turns: number;
  tokens: number;
  oneShotRatePct: number;
  burnedCost: number;
}

interface ModelRow {
  model: string;
  family: "opus" | "sonnet" | "haiku" | "other";
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  turns: number;
}

interface ToolCountRow {
  name: string;
  count: number;
}

interface BashCommandRow {
  command: string;
  count: number;
}

interface McpServerRow {
  server: string;
  count: number;
  tools: string[];
}

interface SubagentTypeRow {
  subagentType: string;
  count: number;
}

interface BackgroundActivity {
  subagentSessions: number;
  subagentTurns: number;
  subagentCost: number;
  subagentTokens: number;
  hookSessions: number;
  hookCost: number;
  subagentTypes: SubagentTypeRow[];
}

interface DashboardAnalytics {
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

// ---- Shared components ----

function DistributionBars({ data, label }: { data: Record<string, number>; label: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return <div className="text-sm text-muted-foreground">No {label.toLowerCase()} data</div>;

  return (
    <div className="space-y-2.5">
      <div className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">{label}</div>
      {entries.map(([key, value]) => {
        const pct = Math.round((value / total) * 100);
        const color = getDistributionColor(key);
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground truncate mr-2">{key}</span>
              <span className="font-mono tabular-nums text-xs text-muted-foreground">
                {value} <span className="text-muted-foreground/50">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
              <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingSkeleton({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Loading {title}...</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="pt-6">
              <div className="h-4 bg-muted/30 rounded w-20 mb-2" />
              <div className="h-8 bg-muted/30 rounded w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---- Tab: Billing ----

type PlanId = "free" | "pro" | "max5x" | "max20x" | "api";

interface SettingsPayload { selectedPlanId: PlanId | null; billingMode: string; }

interface PlanCatalogPlan {
  id: PlanId;
  label: string;
  priceUsdMonthly: number;
  weekly: { sonnetHoursMin: number | null; sonnetHoursMax: number | null; opusHoursMin: number | null; opusHoursMax: number | null; confidence: string };
  sessionWindow: { durationHours: number };
  payPerToken: boolean;
}

interface SessionWindowUsage { windowStartIso: string; windowEndIso: string; resetAtIso: string; tokensUsed: number; costUsd: number; turnsInWindow: number; }
interface PeriodUsagePayload { periodStartIso: string; periodEndIso: string; tokensUsed: number; costUsd: number; sonnetHours: number; opusHours: number; }
interface BuildupPointPayload { date: string; sonnetHours: number; opusHours: number; costUsd: number; cumSonnetHours: number; cumOpusHours: number; cumCostUsd: number; }
interface ThrottleWindow { daysOfWeek: number[]; startHourUtc: number; endHourUtc: number; note: string; }
interface PredictedLimit { periodicity: string; hitAtIso: string; confidence: string; note: string; }
interface PeakHoursPayload { costByDayHour: number[][]; tokensByDayHour: number[][]; timezone: string; }
interface PlanUsagePayload {
  selectedPlanId: PlanId | null;
  plan: PlanCatalogPlan | null;
  billingModeDetected: "subscription" | "api" | "unknown";
  apiKeyPresent: boolean;
  currentSession: SessionWindowUsage | null;
  weekly: PeriodUsagePayload | null;
  weeklyBuildup: BuildupPointPayload[];
  monthly: PeriodUsagePayload | null;
  peakHours: PeakHoursPayload;
  throttleWindows: ThrottleWindow[];
  predictedLimitHit: PredictedLimit | null;
  catalogVersion: string;
  catalogUpdatedAt: string;
  catalogSource: "bundled" | "override";
  durationMs: number;
}

const PLAN_OPTIONS: Array<{ id: PlanId; label: string }> = [
  { id: "free", label: "Free ($0)" },
  { id: "pro", label: "Pro ($20/mo)" },
  { id: "max5x", label: "Max 5x ($100/mo)" },
  { id: "max20x", label: "Max 20x ($200/mo)" },
  { id: "api", label: "API (pay-as-you-go)" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatRelativeDuration(iso: string): string {
  const diffMs = Date.parse(iso) - Date.now();
  if (diffMs <= 0) return "now";
  const h = Math.floor(diffMs / (60 * 60 * 1000));
  const m = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function LimitProgressRow({ label, used, limitLow, limitHigh, unit, sub, help }: { label: string; used: number; limitLow: number | null; limitHigh: number | null; unit: string; sub?: string; help?: React.ReactNode }) {
  const hasLimit = limitLow !== null && limitLow > 0;
  const pctOfLow = hasLimit ? Math.min(100, (used / (limitLow as number)) * 100) : 0;
  let barColor = "bg-emerald-500";
  if (pctOfLow >= 100) barColor = "bg-red-500";
  else if (pctOfLow >= 80) barColor = "bg-amber-500";
  else if (pctOfLow >= 50) barColor = "bg-yellow-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground flex items-center gap-1.5">
          {label}
          {help && <InfoTooltip title={label}>{help}</InfoTooltip>}
        </span>
        <span className="font-mono tabular-nums text-xs">
          {used.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unit}
          {hasLimit && limitHigh !== null && (
            <span className="text-muted-foreground/60"> / {limitLow}-{limitHigh} {unit}</span>
          )}
          {hasLimit && limitHigh === null && (
            <span className="text-muted-foreground/60"> / {limitLow} {unit}</span>
          )}
          {!hasLimit && <span className="text-muted-foreground/60"> · no limit</span>}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pctOfLow}%` }} />
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
    </div>
  );
}

/**
 * Cumulative-hours line chart showing how close the user is to the weekly limit.
 * Solid line = actual cumulative hours across the past 7 days.
 * Dashed line = linear extrapolation from now to the predicted limit hit.
 * Horizontal dashed lines mark the low- and high-end caps from the plan.
 */
function BuildupChart({
  buildup,
  metric,
  label,
  limitLow,
  limitHigh,
  predictedHitIso,
  color = "#10b981",
}: {
  buildup: BuildupPointPayload[];
  metric: "cumSonnetHours" | "cumOpusHours" | "cumCostUsd";
  label: string;
  limitLow: number | null;
  limitHigh: number | null;
  predictedHitIso: string | null;
  color?: string;
}) {
  if (buildup.length === 0) return <p className="text-xs text-muted-foreground/70">No activity in the last 7 days.</p>;

  const W = 560;
  const H = 180;
  const PAD_L = 38;
  const PAD_R = 16;
  const PAD_T = 12;
  const PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const n = buildup.length;
  const current = buildup[n - 1][metric];
  const topCap = Math.max(limitHigh || 0, limitLow || 0, current) * 1.1;
  const effectiveMax = topCap > 0 ? topCap : 1;

  const xFor = (idx: number) => PAD_L + (innerW * (idx / (n - 1 || 1)));
  const yFor = (v: number) => PAD_T + innerH - (innerH * Math.min(v / effectiveMax, 1));

  const points = buildup.map((p, i) => `${xFor(i)},${yFor(p[metric])}`).join(" ");

  let extrapolation: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (predictedHitIso && limitLow) {
    const nowMs = Date.now();
    const hitMs = Date.parse(predictedHitIso);
    const dtHours = Math.max(0, (hitMs - nowMs) / (60 * 60 * 1000));
    const daysAhead = Math.min(7, dtHours / 24);
    const xEnd = xFor(n - 1) + (innerW / (n - 1 || 1)) * daysAhead;
    extrapolation = {
      x1: xFor(n - 1),
      y1: yFor(current),
      x2: Math.min(xEnd, W - PAD_R),
      y2: yFor(limitLow),
    };
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full max-w-full" preserveAspectRatio="xMidYMid meet">
      {/* grid */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="rgba(255,255,255,0.08)" />
      <line x1={PAD_L} y1={PAD_T + innerH} x2={W - PAD_R} y2={PAD_T + innerH} stroke="rgba(255,255,255,0.08)" />

      {/* limit lines */}
      {limitLow !== null && (
        <>
          <line x1={PAD_L} y1={yFor(limitLow)} x2={W - PAD_R} y2={yFor(limitLow)} stroke="rgba(251,191,36,0.6)" strokeDasharray="4 3" />
          <text x={W - PAD_R - 2} y={yFor(limitLow) - 3} fontSize="9" textAnchor="end" fill="#fbbf24">low {limitLow}</text>
        </>
      )}
      {limitHigh !== null && limitHigh !== limitLow && (
        <>
          <line x1={PAD_L} y1={yFor(limitHigh)} x2={W - PAD_R} y2={yFor(limitHigh)} stroke="rgba(239,68,68,0.55)" strokeDasharray="4 3" />
          <text x={W - PAD_R - 2} y={yFor(limitHigh) - 3} fontSize="9" textAnchor="end" fill="#ef4444">high {limitHigh}</text>
        </>
      )}

      {/* y-axis ticks */}
      {[0, 0.5, 1].map(frac => {
        const v = effectiveMax * frac;
        const y = yFor(v);
        return (
          <g key={frac}>
            <text x={PAD_L - 4} y={y + 3} fontSize="9" textAnchor="end" fill="rgba(255,255,255,0.4)">{v.toFixed(v >= 10 ? 0 : 1)}</text>
          </g>
        );
      })}

      {/* x-axis day labels */}
      {buildup.map((p, i) => {
        const d = new Date(p.date + "T00:00:00Z");
        const label = d.toLocaleDateString(undefined, { weekday: "short" });
        const isLast = i === n - 1;
        return (
          <text key={p.date} x={xFor(i)} y={H - 6} fontSize="9" textAnchor="middle" fill={isLast ? "#10b981" : "rgba(255,255,255,0.45)"}>{label}</text>
        );
      })}

      {/* extrapolation */}
      {extrapolation && (
        <line x1={extrapolation.x1} y1={extrapolation.y1} x2={extrapolation.x2} y2={extrapolation.y2} stroke="rgba(251,191,36,0.5)" strokeDasharray="3 3" strokeWidth="1.5" />
      )}

      {/* actual cumulative polyline */}
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />

      {/* data points */}
      {buildup.map((p, i) => {
        const isLast = i === n - 1;
        return <circle key={p.date} cx={xFor(i)} cy={yFor(p[metric])} r={isLast ? 4 : 2.5} fill={isLast ? color : "rgba(255,255,255,0.6)"} />;
      })}

      {/* label in top-left */}
      <text x={PAD_L + 4} y={PAD_T + 10} fontSize="10" fill="rgba(255,255,255,0.65)">{label} · now: {current.toFixed(1)}</text>
    </svg>
  );
}

function isInThrottleWindow(d: number, h: number, throttleWindows: ThrottleWindow[]): boolean {
  const utcHour = new Date().getTimezoneOffset() === 0 ? h : (h + new Date().getTimezoneOffset() / 60 + 48) % 24;
  for (const w of throttleWindows) {
    if (!w.daysOfWeek.includes(d)) continue;
    if (utcHour >= w.startHourUtc && utcHour < w.endHourUtc) return true;
  }
  return false;
}

function formatLocalRange(startHourUtc: number, endHourUtc: number): { label: string; tz: string } {
  const now = new Date();
  // Resolve offset-hours between local and UTC (local = utc - offset)
  const offsetMinutes = now.getTimezoneOffset();
  const offsetHours = -offsetMinutes / 60;
  const modHour = (h: number) => ((h + offsetHours) % 24 + 24) % 24;
  const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${Math.round((h % 1) * 60).toString().padStart(2, "0")}`;
  const localStart = modHour(startHourUtc);
  const localEnd = modHour(endHourUtc);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return { label: `${fmt(localStart)}–${fmt(localEnd)}`, tz };
}

function dayNamesFromIndices(days: number[]): string {
  const WEEKDAYS = [1, 2, 3, 4, 5];
  if (days.length === 5 && days.every((v, i) => v === WEEKDAYS[i])) return "Weekdays";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map(d => names[d]).join(", ");
}

function PeakHoursHeatmap({ data, throttleWindows }: { data: PeakHoursPayload; throttleWindows: ThrottleWindow[] }) {
  const flat = data.costByDayHour.flat();
  const max = Math.max(...flat, 0.0001);
  return (
    <div>
      <div className="grid gap-px" style={{ gridTemplateColumns: "auto repeat(24, minmax(0, 1fr))" }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={`h-${h}`} className="text-[8px] text-muted-foreground/60 text-center font-mono">{h % 3 === 0 ? h : ""}</div>
        ))}
        {DAY_LABELS.map((dayLabel, d) => (
          <>
            <div key={`d-${d}`} className="text-[9px] text-muted-foreground/70 pr-1 flex items-center">{dayLabel}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const value = data.costByDayHour[d]?.[h] ?? 0;
              const opacity = value / max;
              const inThrottle = isInThrottleWindow(d, h, throttleWindows);
              return (
                <div
                  key={`${d}-${h}`}
                  className="aspect-square rounded-[2px] relative"
                  style={{
                    backgroundColor: `rgba(16, 185, 129, ${opacity.toFixed(3)})`,
                    border: inThrottle ? "1px solid rgba(239, 68, 68, 0.5)" : undefined,
                  }}
                  title={`${dayLabel} ${h.toString().padStart(2, "0")}:00 · $${value.toFixed(3)}${inThrottle ? " · Anthropic throttle window" : ""}`}
                />
              );
            })}
          </>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500/30" />light</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" />heavy</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm border border-red-500" />Anthropic peak-throttle window</span>
        <span className="ml-auto opacity-60">Timezone: {data.timezone}</span>
      </div>
    </div>
  );
}

function PlanAwarenessSection() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery<SettingsPayload>({
    queryKey: ["/api/settings"],
    staleTime: 120000,
  });
  const { data: planUsage, isLoading: planLoading } = useQuery<PlanUsagePayload>({
    queryKey: ["/api/analytics/plan-usage"],
    staleTime: 60000,
  });

  const setPlan = useMutation({
    mutationFn: async (planId: PlanId | null) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedPlanId: planId }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/plan-usage"] });
    },
  });

  const refreshCatalog = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/refresh-catalog", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `refresh failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/plan-usage"] });
    },
  });

  const selectedPlanId: PlanId | null = settings?.selectedPlanId ?? null;

  return (
    <div className="space-y-6">
      {/* Plan selector */}
      <Card className="animate-fade-in-up">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-400" />
            Subscription Plan
            {planUsage?.billingModeDetected === "api" && <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1 text-amber-400 border-amber-400/30">ANTHROPIC_API_KEY detected → pay-as-you-go</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={selectedPlanId || ""}
              onChange={(e) => setPlan.mutate((e.target.value || null) as PlanId | null)}
              className="bg-card border border-border rounded-md px-3 py-1.5 text-sm font-mono"
            >
              <option value="">— select plan —</option>
              {PLAN_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[11px] gap-1"
              onClick={() => refreshCatalog.mutate()}
              disabled={refreshCatalog.isPending}
            >
              <RefreshCw className={`h-3 w-3 ${refreshCatalog.isPending ? "animate-spin" : ""}`} />
              {refreshCatalog.isPending ? "Fetching…" : "Refresh catalog"}
            </Button>
            {planUsage && (
              <span className="text-[10px] text-muted-foreground/60 font-mono">
                catalog v{planUsage.catalogVersion} · updated {planUsage.catalogUpdatedAt} · {planUsage.catalogSource}
              </span>
            )}
            {refreshCatalog.isError && <span className="text-[10px] text-red-400">{(refreshCatalog.error as Error)?.message}</span>}
            {refreshCatalog.isSuccess && !refreshCatalog.isPending && (
              <span className="text-[10px] text-emerald-400">
                {refreshCatalog.data?.updated ? `Updated to v${refreshCatalog.data.newVersion}` : "Already on latest version"}
              </span>
            )}
          </div>
          {!selectedPlanId && (
            <p className="text-xs text-muted-foreground/70 mt-3">
              Select your plan to see usage-vs-limit bars, session reset times, and throttle-window guidance. Anthropic does not publish exact token quotas; bars use the low-end of official weekly ranges to bias toward safety.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Plan limit bar */}
      {selectedPlanId && planUsage && planUsage.plan && (
        <Card className="animate-fade-in-up gradient-border" style={{ animationDelay: "100ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-400" />
              Usage vs {planUsage.plan.label}
              {planLoading && <span className="text-[10px] text-muted-foreground/60">computing…</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {planUsage.currentSession ? (
              <LimitProgressRow
                label={`Current ${planUsage.plan.sessionWindow.durationHours}h session`}
                used={planUsage.currentSession.tokensUsed}
                limitLow={null}
                limitHigh={null}
                unit="tokens"
                sub={`Window opened ${new Date(planUsage.currentSession.windowStartIso).toLocaleString()} · resets ${formatRelativeDuration(planUsage.currentSession.resetAtIso)} (${planUsage.currentSession.turnsInWindow} turns · $${planUsage.currentSession.costUsd.toFixed(2)})`}
                help={<><p>Anthropic's rolling 5-hour window. It <b>opens</b> when you send your first message after a 5h+ gap and <b>closes</b> 5h later.</p><p>Inside that window you share a single token pool with every other Claude session (chat + CLI). Hitting the pool triggers the "Reset at …" message.</p><p>The number here is reconstructed from local JSONL timestamps — Anthropic's server-side count may differ by a few minutes.</p></>}
              />
            ) : (
              <div className="text-xs text-muted-foreground/70">No active 5-hour window.</div>
            )}

            {planUsage.weekly && planUsage.plan.weekly.sonnetHoursMin !== null && (
              <LimitProgressRow
                label="Sonnet, rolling 7 days"
                used={planUsage.weekly.sonnetHours}
                limitLow={planUsage.plan.weekly.sonnetHoursMin}
                limitHigh={planUsage.plan.weekly.sonnetHoursMax}
                unit="hours"
                sub={`${planUsage.weekly.tokensUsed.toLocaleString()} tokens · $${planUsage.weekly.costUsd.toFixed(2)} · bar shows % of low-end estimate (${planUsage.plan.weekly.confidence})`}
                help={<><p>Anthropic publishes the weekly cap as a <b>range of hours</b> of Sonnet usage, not exact tokens. The bar uses the <b>low end</b> as the denominator so you get an early warning.</p><p>"Hours" here are estimated by summing gaps between consecutive turns, capped at 30 min per gap — the same heuristic behind Anthropic's own "hours" phrasing.</p><p>Reset: rolling — 7 days from your first activity in the current cycle, not Monday/midnight.</p></>}
              />
            )}

            {planUsage.weekly && planUsage.plan.weekly.opusHoursMin !== null && (
              <LimitProgressRow
                label="Opus, rolling 7 days"
                used={planUsage.weekly.opusHours}
                limitLow={planUsage.plan.weekly.opusHoursMin}
                limitHigh={planUsage.plan.weekly.opusHoursMax}
                unit="hours"
                sub={`Opus has a separate weekly bucket on Max plans.`}
                help={<><p>On <b>Max 5x</b> and <b>Max 20x</b>, Opus has its <b>own</b> weekly pool separate from Sonnet.</p><p>If you hit this bucket, Claude Code usually auto-falls-back to Sonnet until Opus resets. You'll get a "you've used your Opus hours" message.</p><p>Pro plan doesn't get guaranteed Opus hours (Anthropic has not published a Pro Opus cap).</p></>}
              />
            )}

            {planUsage.weekly && planUsage.plan.weekly.sonnetHoursMin === null && !planUsage.plan.payPerToken && (
              <div className="text-xs text-muted-foreground/70">Anthropic has not published weekly hours for the {planUsage.plan.label} plan. Current 7-day spend: {planUsage.weekly.tokensUsed.toLocaleString()} tokens · ${planUsage.weekly.costUsd.toFixed(2)} · ~{planUsage.weekly.sonnetHours}h Sonnet.</div>
            )}

            {planUsage.plan.payPerToken && planUsage.monthly && (
              <LimitProgressRow
                label="Pay-as-you-go · this calendar month"
                used={planUsage.monthly.costUsd}
                limitLow={null}
                limitHigh={null}
                unit="USD"
                sub={`${planUsage.monthly.tokensUsed.toLocaleString()} tokens · no subscription cap applies`}
              />
            )}

            {planUsage.predictedLimitHit && (
              <div className="border-t border-border/40 pt-3">
                <div className="flex items-center gap-2 text-sm">
                  <Repeat className="h-4 w-4 text-amber-400" />
                  <span className="font-medium">Prediction ({planUsage.predictedLimitHit.confidence} confidence)</span>
                  <span className="text-xs text-amber-400 font-mono">{formatRelativeDuration(planUsage.predictedLimitHit.hitAtIso)}</span>
                  <InfoTooltip title="How prediction works" width={360}>
                    <p>Linear extrapolation: we take the trailing 24-hour Sonnet burn rate and project it forward until you'd hit the low-end weekly cap.</p>
                    <p>Confidence is based on sample size: <b>low</b> &lt;10 recent turns, <b>medium</b> 10-40, <b>high</b> 40+. Low confidence means the prediction is unreliable and you should ignore it.</p>
                    <p>If your usage is bursty (long breaks + intense sessions) the line under-predicts. If it's steady, it tracks well.</p>
                  </InfoTooltip>
                </div>
                <p className="text-[11px] text-muted-foreground/70 mt-1">{planUsage.predictedLimitHit.note}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Buildup chart — cumulative weekly hours vs limits */}
      {selectedPlanId && planUsage && planUsage.plan && planUsage.weeklyBuildup.length > 0 && (
        <Card className="animate-fade-in-up" style={{ animationDelay: "125ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Build-up toward weekly limit
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">Last 7 days · cumulative</Badge>
              <InfoTooltip title="How to read this" width={360}>
                <p>The solid line is your <b>cumulative hours</b> over the rolling 7-day weekly cycle. Each dot is a calendar day.</p>
                <p>Dashed horizontal lines are your plan's <b>low</b> (amber) and <b>high</b> (red) weekly caps. Cross the low line and you're in danger zone.</p>
                <p>The faint amber dashed line extrapolates from now forward to show <b>when</b> you'd hit the low cap at the current burn rate.</p>
              </InfoTooltip>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {planUsage.plan.weekly.opusHoursMin !== null && (
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Opus — the tighter cap</div>
                <BuildupChart
                  buildup={planUsage.weeklyBuildup}
                  metric="cumOpusHours"
                  label="Opus hours"
                  limitLow={planUsage.plan.weekly.opusHoursMin}
                  limitHigh={planUsage.plan.weekly.opusHoursMax}
                  predictedHitIso={planUsage.predictedLimitHit?.hitAtIso ?? null}
                  color="#f97316"
                />
              </div>
            )}
            {planUsage.plan.weekly.sonnetHoursMin !== null && (
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Sonnet</div>
                <BuildupChart
                  buildup={planUsage.weeklyBuildup}
                  metric="cumSonnetHours"
                  label="Sonnet hours"
                  limitLow={planUsage.plan.weekly.sonnetHoursMin}
                  limitHigh={planUsage.plan.weekly.sonnetHoursMax}
                  predictedHitIso={planUsage.predictedLimitHit?.hitAtIso ?? null}
                  color="#3b82f6"
                />
              </div>
            )}
            {planUsage.plan.weekly.sonnetHoursMin === null && planUsage.plan.weekly.opusHoursMin === null && (
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Cost (no subscription cap applies)</div>
                <BuildupChart
                  buildup={planUsage.weeklyBuildup}
                  metric="cumCostUsd"
                  label="Cumulative $"
                  limitLow={null}
                  limitHigh={null}
                  predictedHitIso={null}
                  color="#10b981"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Peak-hours heatmap */}
      {planUsage && (
        <Card className="animate-fade-in-up" style={{ animationDelay: "150ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              Peak Hours — your work pattern vs Anthropic throttle windows
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">All-time avg per week</Badge>
              <InfoTooltip title="How to read this" width={360}>
                <p>Each cell shows your <b>average cost per hour-of-week</b> over the entire dataset. Greener = heavier usage that hour.</p>
                <p>Cells with a <b>red border</b> are inside Anthropic's peak-throttle windows, when your 5-hour limit tightens below the usual ceiling.</p>
                <p>Goal: if you have green-red overlap, those are the hours where you're <i>most</i> likely to hit a surprise limit. Try to shift heavy sessions outside those windows.</p>
              </InfoTooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {planUsage.throttleWindows.length > 0 && (() => {
              const w = planUsage.throttleWindows[0];
              const local = formatLocalRange(w.startHourUtc, w.endHourUtc);
              const dayStr = dayNamesFromIndices(w.daysOfWeek);
              return (
                <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-red-300">Anthropic peak-throttle window</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono text-red-300/90">{dayStr}</span>{" "}
                        <span className="font-mono">{String(w.startHourUtc).padStart(2, "0")}:00–{String(w.endHourUtc).padStart(2, "0")}:00 UTC</span>
                        {" · "}
                        <span className="font-mono text-amber-300/90">{local.label}</span>
                        {" "}
                        <span className="text-muted-foreground/60">({local.tz} — your local time)</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/80">{w.note}</p>
                    </div>
                  </div>
                </div>
              );
            })()}
            <PeakHoursHeatmap data={planUsage.peakHours} throttleWindows={planUsage.throttleWindows} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BillingTab() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<CostAnalytics>({
    queryKey: ["/api/analytics/costs"],
    staleTime: 60000,
  });

  if (isLoading || !data) return (
    <div className="space-y-6">
      <PlanAwarenessSection />
      <LoadingSkeleton title="cost data" />
    </div>
  );

  const inputPricePerToken = 3 / 1_000_000;
  const cacheReadPricePerToken = 0.3 / 1_000_000;
  const costWithoutCache = data.totalCost + data.totalCacheReadTokens * (inputPricePerToken - cacheReadPricePerToken);
  const cacheSavings = costWithoutCache > 0 ? ((costWithoutCache - data.totalCost) / costWithoutCache) * 100 : 0;
  const maxDayCost = Math.max(...data.dailyCosts.map((d) => d.cost), 0.01);
  const currentSpend = data.totalCost;
  const maxPlanLimit = data.planLimits.max20x.limit;
  const spendPctOf100 = maxPlanLimit > 0 ? (currentSpend / data.planLimits.max5x.limit) * 100 : 0;
  let spendColor = "bg-green-500";
  if (spendPctOf100 > 80) spendColor = "bg-red-500";
  else if (spendPctOf100 > 50) spendColor = "bg-yellow-500";
  const modelEntries = Object.entries(data.byModel).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div className="space-y-6">
      <PlanAwarenessSection />

      <div className="border-t border-border/30 pt-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cost &amp; Error Breakdown</h2>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          {
            icon: DollarSign, color: "text-green-400", label: "Total Cost", value: formatCost(data.totalCost),
            help: <><p>All-time API-equivalent cost across every session. Computed from live per-million-token rates (claude.com/pricing, updated 2026-04-15).</p><p>For subscribers this is the <b>equivalent</b> cost, not your actual bill — Pro/Max is a flat monthly fee.</p></>
          },
          {
            icon: TrendingUp, color: "text-blue-400", label: "Input Tokens", value: formatTokens(data.totalInputTokens),
            help: <><p>Total tokens sent <b>to</b> Claude (your messages, system prompts, tool results, context files).</p><p>Does not include cached reads — those are shown separately. Anthropic caps plan usage in tokens, not messages.</p></>
          },
          {
            icon: Zap, color: "text-amber-400", label: "Output Tokens", value: formatTokens(data.totalOutputTokens),
            help: <><p>Total tokens Claude generated <b>back</b> — the actual replies, tool-use blocks, and thinking.</p><p>Output is priced 5× higher than input, so this is usually the biggest cost lever.</p></>
          },
          {
            icon: Shield, color: "text-purple-400", label: "Cache Savings", value: `${cacheSavings.toFixed(0)}%`, sub: `${formatTokens(data.totalCacheReadTokens)} cached reads`,
            help: <><p>How much of your input was served from Anthropic's prompt cache instead of re-billing at full input price.</p><p>Formula: (theoretical-cost-if-no-cache − actual-cost) ÷ theoretical. High % means long sessions are reusing the same context efficiently.</p></>
          },
        ] as const).map((item, i) => (
          <div key={item.label} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
            <Card className="gradient-border">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                  <span className="text-xs font-medium">{item.label}</span>
                  <InfoTooltip title={item.label}>{item.help}</InfoTooltip>
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums">{item.value}</div>
                {"sub" in item && item.sub && (
                  <div className="text-[10px] text-muted-foreground/60 mt-0.5">{item.sub}</div>
                )}
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Daily Cost Chart */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-400" />
            Daily Cost
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">Last 30 days</Badge>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-6 text-[10px] gap-1"
              onClick={() => downloadCSV("claude-daily-costs.csv", data.dailyCosts.map(d => ({
                date: d.date,
                input_tokens: d.inputTokens,
                output_tokens: d.outputTokens,
                cache_read_tokens: d.cacheReadTokens,
                cache_write_tokens: d.cacheWriteTokens,
                cost_usd: d.cost,
              })))}
            >
              <Download className="h-3 w-3" />CSV
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-48">
            {data.dailyCosts.map((day) => {
              const heightPct = maxDayCost > 0 ? (day.cost / maxDayCost) * 100 : 0;
              const today = isToday(day.date);
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className={`text-[9px] font-mono tabular-nums transition-opacity ${day.cost > 0 ? "opacity-0 group-hover:opacity-100" : "opacity-0"} ${today ? "text-green-400 font-semibold" : "text-muted-foreground"}`}>
                    ${day.cost.toFixed(2)}
                  </span>
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-sm transition-all duration-300 min-h-[2px] ${today ? "bg-gradient-to-t from-green-500 to-green-400 shadow-[0_0_8px_rgba(34,197,94,0.3)]" : day.cost > 0 ? "bg-gradient-to-t from-green-500/60 to-green-400/40 group-hover:from-green-500/80 group-hover:to-green-400/60" : "bg-muted/20"}`}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    />
                  </div>
                  <span className={`text-[8px] whitespace-nowrap ${today ? "text-green-400 font-semibold" : "text-muted-foreground/60"}`}>
                    {formatDayLabel(day.date)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "250ms" }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-400" />
            Plan Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Current Spend</span>
              <span className="font-mono font-bold tabular-nums">{formatCost(currentSpend)}</span>
            </div>
            <div className="relative h-6 rounded-full bg-muted/30 overflow-hidden">
              <div className={`h-full rounded-full ${spendColor} transition-all duration-500 opacity-80`} style={{ width: `${Math.min((currentSpend / Math.max(maxPlanLimit, 1)) * 100, 100)}%` }} />
              <div className="absolute top-0 bottom-0 w-px bg-yellow-400/70" style={{ left: `${(data.planLimits.max5x.limit / maxPlanLimit) * 100}%` }} title="Max $100/mo" />
              <div className="absolute top-0 bottom-0 w-px bg-red-400/70" style={{ left: "100%" }} title="Max $200/mo" />
            </div>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted/50" />{data.planLimits.pro.label}</span>
              <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-yellow-400/70" />{data.planLimits.max5x.label}</span>
              <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-red-400/70" />{data.planLimits.max20x.label}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model & Project Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4 text-purple-400" />
              Per-Model Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {modelEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No model data available</p>
            ) : (
              <div className="space-y-0.5">
                <div className="flex items-center text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 py-1.5">
                  <span className="flex-1">Model</span>
                  <span className="w-20 text-right">Input</span>
                  <span className="w-20 text-right">Output</span>
                  <span className="w-16 text-right">Cost</span>
                  <span className="w-16 text-right">Sessions</span>
                </div>
                {modelEntries.map(([model, md]) => (
                  <div key={model} className="flex items-center w-full text-sm px-2 py-2 rounded-md hover:bg-accent/30 transition-colors">
                    <span className="flex-1 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${getModelColor(model)}`} />
                      <span className="text-muted-foreground capitalize">{model}</span>
                    </span>
                    <span className="w-20 text-right font-mono tabular-nums text-xs text-muted-foreground">{formatTokens(md.inputTokens)}</span>
                    <span className="w-20 text-right font-mono tabular-nums text-xs text-muted-foreground">{formatTokens(md.outputTokens)}</span>
                    <span className="w-16 text-right font-mono tabular-nums text-xs text-amber-400/80">{formatCost(md.cost)}</span>
                    <span className="w-16 text-right font-mono tabular-nums text-xs text-muted-foreground">{md.sessions}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: "350ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-orange-400" />
              Per-Project Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.byProject.length === 0 ? (
              <p className="text-sm text-muted-foreground">No project data available</p>
            ) : (
              <div className="space-y-0.5 max-h-[400px] overflow-auto">
                <div className="flex items-center text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 py-1.5 sticky top-0 bg-card">
                  <span className="flex-1">Project</span>
                  <span className="w-16 text-right">Cost</span>
                  <span className="w-16 text-right">Sessions</span>
                </div>
                {data.byProject.map((project) => (
                  <div
                    key={project.project}
                    className="flex items-center w-full text-sm px-2 py-2 rounded-md hover:bg-accent/30 transition-colors cursor-pointer"
                    onClick={() => setLocation(`/sessions?project=${encodeURIComponent(project.project)}`)}
                  >
                    <span className="flex-1 truncate text-muted-foreground hover:text-foreground transition-colors">{lastPathSegment(project.project)}</span>
                    <span className="w-16 text-right font-mono tabular-nums text-xs text-amber-400/80">{formatCost(project.cost)}</span>
                    <span className="w-16 text-right font-mono tabular-nums text-xs text-muted-foreground">{project.sessions}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Error Breakdown */}
      {data.errors.length > 0 && (
        <Card className="animate-fade-in-up" style={{ animationDelay: "400ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Error Breakdown
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">
                {data.errors.reduce((sum, e) => sum + e.count, 0)} total
              </Badge>
              <InfoTooltip title="What this is" width={380}>
                <p>Every time a tool Claude ran returned with <code>is_error: true</code>, it's counted here. A high count <b>isn't always bad</b> — Claude often iterates through errors to find the right fix.</p>
                <p className="mt-1.5 font-semibold text-foreground">What to do with this:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>If <b>tool error</b> or <b>other</b> dominates and most are "Exit code 1 / command failed" — your scripts may need fixing or Claude is being asked to run things it shouldn't.</li>
                  <li>If <b>permission</b> is high — grant the paths Claude keeps asking for (<code>.claude/settings.local.json</code>).</li>
                  <li>If <b>network</b> spikes — local service is down or Cloudflare tunnel dropped.</li>
                  <li>If <b>compilation</b> or <b>test failure</b> dominates — normal for a codebase being edited; no action needed.</li>
                </ul>
                <p className="mt-1.5">Errors are classified from the text of the <code>tool_result</code> content using keyword matching.</p>
              </InfoTooltip>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.errors.map((err) => {
                const style = ERROR_STYLES[err.type] || ERROR_STYLES.other;
                const Icon = style.icon;
                const help = errorHelpFor(err.type);
                return (
                  <div key={err.type} className={`rounded-lg border p-3 ${style.bg} ${style.border}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon className={`h-4 w-4 ${style.text}`} />
                      <span className={`text-sm font-medium ${style.text}`}>{err.type.replace(/_/g, " ")}</span>
                      {help && <InfoTooltip title={`${err.type.replace(/_/g, " ")} — what to do`} width={360}>{help}</InfoTooltip>}
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ml-auto ${style.text} border-current`}>{err.count}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{err.example}</p>
                    {err.lastSeen && <p className="text-[10px] text-muted-foreground/50 mt-1">Last: {new Date(err.lastSeen).toLocaleDateString()}</p>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Tab: Dashboard ----

const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All" },
];

function barColorForOneShot(pct: number): string {
  if (pct < 60) return "bg-red-500";
  if (pct < 85) return "bg-amber-500";
  return "bg-emerald-500";
}

function modelColorByFamily(family: string): string {
  if (family === "opus") return "bg-orange-500";
  if (family === "sonnet") return "bg-blue-500";
  if (family === "haiku") return "bg-green-500";
  return "bg-zinc-500";
}

function ActivityTab() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<TimeRange>("7d");
  const { data: overview } = useQuery<StatsOverview>({
    queryKey: ["/api/stats/overview"],
    staleTime: 60000,
  });
  const { data, isLoading } = useQuery<DashboardAnalytics>({
    queryKey: ["/api/analytics/dashboard", range],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/dashboard?range=${range}`);
      if (!res.ok) throw new Error("failed to fetch dashboard analytics");
      return res.json();
    },
    staleTime: 60000,
  });

  const maxDayCost = Math.max(...(data?.byDay.map(d => d.cost) ?? []), 0.01);

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex items-center gap-1 flex-wrap">
        {TIME_RANGES.map(r => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${range === r.value ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground"}`}
          >
            {r.label}
          </button>
        ))}
        {data && (
          <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">
            Scanned {data.header.totalSessions} sessions in {data.durationMs}ms
          </span>
        )}
      </div>

      {isLoading || !data ? (
        <LoadingSkeleton title="dashboard data" />
      ) : (
        <>
          {/* Header cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {([
              {
                icon: DollarSign, color: "text-green-400", label: "Total Cost",
                value: formatCost(data.header.totalCost), sub: data.header.rangeLabel,
                help: <><p>Per-token rates multiplied by the tokens used in this range.</p><p>For <b>subscribers</b> this is the equivalent API cost — your actual Pro/Max bill is a flat monthly fee and does not change. For <b>API users</b> this matches real spend.</p><p>Source: claude.com/pricing. Rates updated 2026-04-15.</p></>
              },
              {
                icon: Zap, color: "text-amber-400", label: "Active Tokens",
                value: formatTokens(data.header.activeTokens), sub: "input + output + cache-write",
                help: <><p>Sum of <b>input</b> + <b>output</b> + <b>cache-creation</b> tokens. Excludes cache-reads (those are ~10× cheaper and tracked separately as Cached Tokens).</p><p>Anthropic measures plan capacity in <b>tokens</b>, not messages. This is the number that maps to your weekly cap.</p></>
              },
              {
                icon: Shield, color: "text-purple-400", label: "Cached Tokens",
                value: formatTokens(data.header.cachedTokens), sub: `${data.header.cacheHitRatePct.toFixed(1)}% hit rate`,
                help: <><p>Tokens read from Anthropic's prompt cache — cheap re-reads of context you already sent.</p><p>Cost: ~1/10 of a fresh input token. High hit rate means efficient re-use (long conversations on the same context).</p><p>Hit rate = cached / (cached + active).</p></>
              },
              {
                icon: MessageSquare, color: "text-blue-400", label: "Sessions",
                value: data.header.totalSessions.toLocaleString(), sub: `${data.header.totalTurns.toLocaleString()} turns`,
                help: <><p>Count of JSONL session files in <code>~/.claude/projects/</code> that had at least one turn in this time range.</p><p>Turns = assistant messages with a <code>usage</code> block. Subagent turns are counted in the Background Activity panel below.</p></>
              },
              {
                icon: Target, color: "text-emerald-400", label: "One-Shot",
                value: `${data.oneShotRatePct.toFixed(1)}%`, sub: `${data.burnPct.toFixed(1)}% burn`,
                help: <><p>Percentage of turns that landed <b>without</b> a retry loop.</p><p>A turn is flagged as "burn" when: the same file is edited within 3 minutes of a prior edit, or a Coding turn immediately follows a <code>tool_result.is_error</code>, or the same bash test command re-runs inside 3 minutes.</p><p>Higher one-shot = fewer wasted tokens on rework.</p></>
              },
            ] as const).map((item, i) => (
              <div key={item.label} className="animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                <Card className="gradient-border">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                      <span className="text-xs font-medium">{item.label}</span>
                      <InfoTooltip title={item.label}>{item.help}</InfoTooltip>
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums">{item.value}</div>
                    <div className="text-[10px] text-muted-foreground/60 mt-0.5">{item.sub}</div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>

          {/* Daily activity bar chart */}
          <Card className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-green-400" />
                Daily Activity
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">{data.header.rangeLabel}</Badge>
                <InfoTooltip title="Daily Activity">
                  <p>Each bar is one calendar day. Height = total <b>API-equivalent cost</b> that day across all sessions (parent + subagent JSONL files).</p>
                  <p>Each bar has two segments: <b>emerald</b> = productive spend (first-try successful turns), <b>red</b> = burn spend (turns that landed inside a retry loop).</p>
                  <p>Labels are shown for the biggest bars by default; hover any bar to see its number.</p>
                </InfoTooltip>
                <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" />Productive</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red-500/70" />Burn</span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.byDay.length === 0 || data.byDay.every(d => d.cost === 0) ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground mb-1">No activity in this time range</p>
                  <p className="text-[11px] text-muted-foreground/60">Try a wider range (30 Days / This Month / All) or check if this user has Claude Code sessions under <code>~/.claude/projects/</code>.</p>
                </div>
              ) : (
                <div className="flex items-end gap-1 h-56">
                  {data.byDay.map((day) => {
                    const heightPct = maxDayCost > 0 ? (day.cost / maxDayCost) * 100 : 0;
                    const burnPct = day.cost > 0 ? (day.burnedCost / day.cost) * 100 : 0;
                    const today = isToday(day.date);
                    const hasData = day.cost > 0;
                    const showLabel = day.cost >= maxDayCost * 0.15 || today;
                    return (
                      <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                        <span className={`text-[10px] font-mono tabular-nums transition-opacity ${showLabel ? "opacity-100" : "opacity-0 group-hover:opacity-100"} ${today ? "text-green-400 font-semibold" : hasData ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                          {hasData ? `$${day.cost.toFixed(day.cost >= 10 ? 0 : 2)}` : "—"}
                        </span>
                        <div className="w-full flex-1 flex items-end">
                          <div
                            className={`w-full rounded-t-sm overflow-hidden flex flex-col justify-end ${hasData ? "min-h-[6px]" : "min-h-[2px] bg-muted/15"}`}
                            style={{ height: `${hasData ? Math.max(heightPct, 4) : 2}%` }}
                          >
                            {hasData && (
                              <>
                                <div className="w-full bg-gradient-to-t from-red-600/80 to-red-400/70" style={{ height: `${burnPct}%` }} />
                                <div className="w-full bg-gradient-to-t from-emerald-600/70 to-emerald-400/60" style={{ height: `${100 - burnPct}%` }} />
                              </>
                            )}
                          </div>
                        </div>
                        <span className={`text-[9px] whitespace-nowrap ${today ? "text-green-400 font-semibold" : "text-muted-foreground/60"}`}>
                          {formatDayLabel(day.date)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* By Project + By Model */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="animate-fade-in-up" style={{ animationDelay: "250ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-orange-400" />
                  By Project
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.byProject.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No project data</p>
                ) : (
                  <div className="space-y-0.5 max-h-[320px] overflow-auto">
                    <div className="flex items-center text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 py-1.5 sticky top-0 bg-card">
                      <span className="flex-1">Project</span>
                      <span className="w-16 text-right">Cost</span>
                      <span className="w-16 text-right">Sessions</span>
                      <span className="w-16 text-right">Turns</span>
                    </div>
                    {data.byProject.slice(0, 20).map((p) => (
                      <button
                        key={p.project}
                        onClick={() => setLocation(`/sessions?project=${encodeURIComponent(p.project)}`)}
                        className="flex items-center w-full text-sm hover:bg-accent/30 px-2 py-2 rounded-md transition-colors text-left"
                      >
                        <span className="flex-1 truncate text-muted-foreground">{p.projectLabel}</span>
                        <span className="w-16 text-right font-mono tabular-nums text-xs text-amber-400/80">{formatCost(p.cost)}</span>
                        <span className="w-16 text-right font-mono tabular-nums text-xs text-muted-foreground">{p.sessions}</span>
                        <span className="w-16 text-right font-mono tabular-nums text-xs text-muted-foreground">{p.turns}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-purple-400" />
                  By Model
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.byModel.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No model data</p>
                ) : (
                  <div className="space-y-0.5 max-h-[320px] overflow-auto">
                    <div className="flex items-center text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 py-1.5">
                      <span className="flex-1">Model</span>
                      <span className="w-16 text-right">Cost</span>
                      <span className="w-20 text-right">Tokens</span>
                      <span className="w-12 text-right">Turns</span>
                    </div>
                    {data.byModel.map((m) => (
                      <div key={m.model} className="flex items-center w-full text-sm px-2 py-2 rounded-md hover:bg-accent/30">
                        <span className="flex-1 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${modelColorByFamily(m.family)}`} />
                          <span className="text-muted-foreground text-xs truncate">{m.model}</span>
                        </span>
                        <span className="w-16 text-right font-mono tabular-nums text-xs text-amber-400/80">{formatCost(m.cost)}</span>
                        <span className="w-20 text-right font-mono tabular-nums text-xs text-muted-foreground">{formatTokens(m.inputTokens + m.outputTokens)}</span>
                        <span className="w-12 text-right font-mono tabular-nums text-xs text-muted-foreground">{m.turns}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* By Activity + Background */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="animate-fade-in-up" style={{ animationDelay: "350ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Target className="h-4 w-4 text-emerald-400" />
                  By Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.byActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity data</p>
                ) : (
                  <div className="space-y-0.5">
                    <div className="flex items-center text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 py-1.5">
                      <span className="flex-1">Category</span>
                      <span className="w-14 text-right">Turns</span>
                      <span className="w-16 text-right">Cost</span>
                      <span className="w-28 text-right">One-Shot</span>
                    </div>
                    {data.byActivity.map((a) => (
                      <div key={a.category} className="flex items-center w-full text-sm px-2 py-2 rounded-md hover:bg-accent/30">
                        <span className="flex-1 text-muted-foreground">{a.category}</span>
                        <span className="w-14 text-right font-mono tabular-nums text-xs text-muted-foreground">{a.turns}</span>
                        <span className="w-16 text-right font-mono tabular-nums text-xs text-amber-400/80">{formatCost(a.cost)}</span>
                        <div className="w-28 flex items-center gap-2 justify-end">
                          <div className="h-2 w-14 rounded-full bg-muted/30 overflow-hidden">
                            <div className={`h-full rounded-full ${barColorForOneShot(a.oneShotRatePct)}`} style={{ width: `${a.oneShotRatePct}%` }} />
                          </div>
                          <span className="font-mono tabular-nums text-xs w-12 text-right">{a.oneShotRatePct.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="animate-fade-in-up border-red-500/20" style={{ animationDelay: "400ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Flame className="h-4 w-4 text-red-400" />
                  Background Activity
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1 border-red-500/30 text-red-400">subagents + hooks</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Subagent sessions</div>
                    <div className="font-mono tabular-nums text-lg">{data.background.subagentSessions.toLocaleString()}</div>
                    <div className="text-[10px] text-amber-400/80">{formatCost(data.background.subagentCost)} · {formatTokens(data.background.subagentTokens)} tokens</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Hook / automation sessions</div>
                    <div className="font-mono tabular-nums text-lg">{data.background.hookSessions.toLocaleString()}</div>
                    <div className="text-[10px] text-amber-400/80">{formatCost(data.background.hookCost)}</div>
                  </div>
                </div>
                {data.background.subagentTypes.length > 0 && (
                  <div className="border-t border-border/30 pt-3">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Subagent types delegated</div>
                    <div className="space-y-0.5 max-h-[180px] overflow-auto">
                      {data.background.subagentTypes.map((s) => (
                        <div key={s.subagentType} className="flex items-center justify-between text-xs px-1 py-1">
                          <span className="text-muted-foreground truncate">{s.subagentType}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">{s.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 3-col breakdown: Core Tools / Bash / MCP */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="animate-fade-in-up" style={{ animationDelay: "450ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-blue-400" />
                  Core Tools
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.coreTools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tool usage</p>
                ) : (
                  <div className="space-y-0.5 max-h-[280px] overflow-auto">
                    {data.coreTools.map((t) => (
                      <div key={t.name} className="flex items-center justify-between text-sm px-2 py-1.5 rounded-md hover:bg-accent/30">
                        <span className="text-muted-foreground">{t.name}</span>
                        <span className="font-mono tabular-nums text-xs text-blue-400/80">{t.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="animate-fade-in-up" style={{ animationDelay: "500ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-amber-400" />
                  Bash Commands
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.bashCommands.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bash usage</p>
                ) : (
                  <div className="space-y-0.5 max-h-[280px] overflow-auto">
                    {data.bashCommands.map((b) => (
                      <div key={b.command} className="flex items-center justify-between text-sm px-2 py-1.5 rounded-md hover:bg-accent/30">
                        <span className="text-muted-foreground font-mono text-xs truncate">{b.command}</span>
                        <span className="font-mono tabular-nums text-xs text-amber-400/80">{b.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="animate-fade-in-up" style={{ animationDelay: "550ms" }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Server className="h-4 w-4 text-purple-400" />
                  MCP Servers
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.mcpServers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No MCP usage</p>
                ) : (
                  <div className="space-y-0.5 max-h-[280px] overflow-auto">
                    {data.mcpServers.map((s) => (
                      <div key={s.server} className="flex items-center justify-between text-sm px-2 py-1.5 rounded-md hover:bg-accent/30" title={`${s.tools.length} distinct tools: ${s.tools.slice(0, 5).join(", ")}${s.tools.length > 5 ? "…" : ""}`}>
                        <span className="text-muted-foreground font-mono text-xs truncate">{s.server}</span>
                        <span className="font-mono tabular-nums text-xs text-purple-400/80">{s.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Storage + agent-type distribution (absorbed from old Usage tab) */}
          {overview && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="animate-fade-in-up" style={{ animationDelay: "600ms" }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-emerald-400" />
                    Storage & Sessions
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">All time</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Sessions</div>
                      <div className="font-mono tabular-nums text-xl mt-1">{overview.totalSessions.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Agent Executions</div>
                      <div className="font-mono tabular-nums text-xl mt-1">{overview.totalAgentExecutions.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Session Size</div>
                      <div className="font-mono tabular-nums text-xl mt-1">{formatBytes(overview.averageSessionSize)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total JSONL Storage</div>
                      <div className="font-mono tabular-nums text-xl mt-1">{formatBytes(overview.totalTokensEstimate)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="animate-fade-in-up" style={{ animationDelay: "650ms" }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Bot className="h-4 w-4 text-purple-400" />
                    Agent Type Distribution
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">All time</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DistributionBars data={overview.agentTypeDistribution} label="Type" />
                </CardContent>
              </Card>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/50 pt-2">
            Activity tab includes subagent JSONL files (sessions spawned via the Task tool) in the header totals, per-model, per-day, and Background Activity panel. Cache-read tokens are excluded from Active Tokens but contribute to Cached Tokens and the cost figure. Activity categorization is deterministic from tool-use patterns.
          </p>
        </>
      )}
    </div>
  );
}

// ---- Main Analytics Page ----

export default function Stats() {
  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold text-gradient">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Usage statistics and cost analytics
        </p>
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab />
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          <BillingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
