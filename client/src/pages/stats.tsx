import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Download } from "lucide-react";

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

// ---- Tab: Usage ----

function UsageTab() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<StatsOverview>({
    queryKey: ["/api/stats/overview"],
    staleTime: 30000,
  });

  if (isLoading || !data) return <LoadingSkeleton title="usage stats" />;

  const maxDayCount = Math.max(...data.sessionsPerDay.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: MessageSquare, color: "text-blue-400", label: "Total Sessions", value: data.totalSessions.toLocaleString() },
          { icon: Bot, color: "text-purple-400", label: "Agent Executions", value: data.totalAgentExecutions.toLocaleString() },
          { icon: HardDrive, color: "text-emerald-400", label: "Avg Session Size", value: formatBytes(data.averageSessionSize) },
          { icon: FolderOpen, color: "text-orange-400", label: "Total Storage", value: formatBytes(data.totalTokensEstimate) },
        ].map((item, i) => (
          <div key={item.label} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
            <Card className="gradient-border">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                  <span className="text-xs font-medium">{item.label}</span>
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums">{item.value}</div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Sessions per Day */}
      <Card className="animate-fade-in-up" style={{ animationDelay: "200ms" }}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            Sessions per Day
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-1">Last 14 days</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1.5 h-48">
            {data.sessionsPerDay.map((day) => {
              const heightPct = maxDayCount > 0 ? (day.count / maxDayCount) * 100 : 0;
              const today = isToday(day.date);
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className={`text-[10px] font-mono tabular-nums transition-opacity ${day.count > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-50"} ${today ? "text-blue-400 font-semibold" : "text-muted-foreground"}`}>
                    {day.count}
                  </span>
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className={`w-full rounded-t-sm transition-all duration-300 min-h-[2px] ${today ? "bg-gradient-to-t from-blue-500 to-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.3)]" : day.count > 0 ? "bg-gradient-to-t from-blue-500/60 to-blue-400/40 group-hover:from-blue-500/80 group-hover:to-blue-400/60" : "bg-muted/20"}`}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                    />
                  </div>
                  <span className={`text-[9px] whitespace-nowrap ${today ? "text-blue-400 font-semibold" : "text-muted-foreground/60"}`}>
                    {formatDayLabel(day.date)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Two columns: Projects + Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="animate-fade-in-up" style={{ animationDelay: "250ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-blue-400" />
              Top Projects
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No project data available</p>
            ) : (
              <div className="space-y-0.5">
                <div className="flex items-center text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider px-2 py-1.5">
                  <span className="flex-1">Project</span>
                  <span className="w-20 text-right">Sessions</span>
                  <span className="w-20 text-right">Size</span>
                </div>
                {data.topProjects.map((project) => (
                  <button
                    key={project.name}
                    className="flex items-center w-full text-sm hover:bg-accent/30 px-2 py-2 rounded-md transition-colors text-left group"
                    onClick={() => setLocation("/projects")}
                  >
                    <span className="flex-1 truncate text-muted-foreground group-hover:text-foreground transition-colors">{project.name}</span>
                    <span className="w-20 text-right font-mono tabular-nums text-xs">{project.sessions}</span>
                    <span className="w-20 text-right font-mono tabular-nums text-xs text-muted-foreground">{formatBytes(project.size)}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: "300ms" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4 text-purple-400" />
              Distributions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <DistributionBars data={data.agentTypeDistribution} label="Agent Type" />
            <div className="border-t border-border/50" />
            <DistributionBars data={data.modelDistribution} label="Model" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Tab: Costs ----

function CostsTab() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<CostAnalytics>({
    queryKey: ["/api/analytics/costs"],
    staleTime: 60000,
  });

  if (isLoading || !data) return <LoadingSkeleton title="cost data" />;

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
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: DollarSign, color: "text-green-400", label: "Total Cost", value: formatCost(data.totalCost) },
          { icon: TrendingUp, color: "text-blue-400", label: "Input Tokens", value: formatTokens(data.totalInputTokens) },
          { icon: Zap, color: "text-amber-400", label: "Output Tokens", value: formatTokens(data.totalOutputTokens) },
          { icon: Shield, color: "text-purple-400", label: "Cache Savings", value: `${cacheSavings.toFixed(0)}%`, sub: `${formatTokens(data.totalCacheReadTokens)} cached reads` },
        ].map((item, i) => (
          <div key={item.label} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
            <Card className="gradient-border">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                  <span className="text-xs font-medium">{item.label}</span>
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
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.errors.map((err) => {
                const style = ERROR_STYLES[err.type] || ERROR_STYLES.other;
                const Icon = style.icon;
                return (
                  <div key={err.type} className={`rounded-lg border p-3 ${style.bg} ${style.border}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon className={`h-4 w-4 ${style.text}`} />
                      <span className={`text-sm font-medium ${style.text}`}>{err.type.replace(/_/g, " ")}</span>
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

function DashboardTab() {
  const [, setLocation] = useLocation();
  const [range, setRange] = useState<TimeRange>("7d");
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
            {[
              { icon: DollarSign, color: "text-green-400", label: "Total Cost", value: formatCost(data.header.totalCost), sub: data.header.rangeLabel },
              { icon: Zap, color: "text-amber-400", label: "Active Tokens", value: formatTokens(data.header.activeTokens), sub: "input + output + cache-write" },
              { icon: Shield, color: "text-purple-400", label: "Cached Tokens", value: formatTokens(data.header.cachedTokens), sub: `${data.header.cacheHitRatePct.toFixed(1)}% hit rate` },
              { icon: MessageSquare, color: "text-blue-400", label: "Sessions", value: data.header.totalSessions.toLocaleString(), sub: `${data.header.totalTurns.toLocaleString()} turns` },
              { icon: Target, color: "text-emerald-400", label: "One-Shot", value: `${data.oneShotRatePct.toFixed(1)}%`, sub: `${data.burnPct.toFixed(1)}% burn` },
            ].map((item, i) => (
              <div key={item.label} className="animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                <Card className="gradient-border">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
                      <item.icon className={`h-4 w-4 ${item.color}`} />
                      <span className="text-xs font-medium">{item.label}</span>
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
                <div className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500/70" />Productive</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red-500/70" />Burn</span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.byDay.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity in this range</p>
              ) : (
                <div className="flex items-end gap-1 h-48">
                  {data.byDay.map((day) => {
                    const heightPct = maxDayCost > 0 ? (day.cost / maxDayCost) * 100 : 0;
                    const burnPct = day.cost > 0 ? (day.burnedCost / day.cost) * 100 : 0;
                    const today = isToday(day.date);
                    return (
                      <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group">
                        <span className={`text-[9px] font-mono tabular-nums opacity-0 group-hover:opacity-100 transition-opacity ${today ? "text-green-400 font-semibold" : "text-muted-foreground"}`}>
                          ${day.cost.toFixed(2)}
                        </span>
                        <div className="w-full flex-1 flex items-end">
                          <div
                            className="w-full rounded-t-sm overflow-hidden flex flex-col justify-end min-h-[2px]"
                            style={{ height: `${Math.max(heightPct, 2)}%` }}
                          >
                            <div className="w-full bg-gradient-to-t from-red-600/80 to-red-400/70" style={{ height: `${burnPct}%` }} />
                            <div className="w-full bg-gradient-to-t from-emerald-600/60 to-emerald-400/50" style={{ height: `${100 - burnPct}%` }} />
                          </div>
                        </div>
                        <span className={`text-[8px] whitespace-nowrap ${today ? "text-green-400 font-semibold" : "text-muted-foreground/60"}`}>
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

          <p className="text-[10px] text-muted-foreground/50 pt-2">
            Dashboard includes subagent JSONL files (sessions spawned via the Task tool) in the header totals, per-model, per-day, and Background Activity panel. Cache-read tokens are excluded from Active Tokens but contribute to Cached Tokens and the cost figure. Activity categorization is deterministic from tool-use patterns; the 3-minute burn detection window matches the Burn tab spec.
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

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab />
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <UsageTab />
        </TabsContent>

        <TabsContent value="costs" className="mt-4">
          <CostsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
