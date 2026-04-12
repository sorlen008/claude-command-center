import { useLocation } from "wouter";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EntityIcon, entityConfig } from "@/components/entity-badge";
import { useScanStatus, useRescan, useEntities } from "@/hooks/use-entities";
import { useRuntimeConfig } from "@/hooks/use-config";
import { useAppSettings } from "@/hooks/use-settings";
import { useProjects } from "@/hooks/use-projects";
import {
  RefreshCw, Clock, HardDrive, Cpu, Activity, Database,
  FolderOpen, Server, Wand2, FileText, GitBranch, Search,
  ExternalLink, BarChart3, Zap, CheckCircle2, AlertCircle, Loader2,
  Radio, Terminal, Keyboard, Download, Gauge,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLiveData } from "@/hooks/use-agents";
import { MoodPlayerButton } from "@/components/mood-player";
import type { EntityType } from "@shared/types";
import { formatBytes, relativeTime } from "@/lib/utils";

const entityTypes: EntityType[] = ["project", "mcp", "skill", "plugin", "markdown", "config"];

const quickActions = [
  { label: "View Graph", description: "Explore entity relationships", icon: GitBranch, path: "/graph", color: "text-indigo-400", bg: "bg-indigo-500/10" },
  { label: "Live View", description: "Active sessions & agents", icon: Radio, path: "/live", color: "text-green-400", bg: "bg-green-500/10" },
  { label: "Edit CLAUDE.md", description: "Project instructions", icon: FileText, path: "/markdown", color: "text-blue-400", bg: "bg-blue-500/10" },
  { label: "Stats", description: "Usage analytics", icon: BarChart3, path: "/stats", color: "text-amber-400", bg: "bg-amber-500/10" },
  { label: "Export Data", description: "Download backup", icon: Download, path: "/api/export", color: "text-cyan-400", bg: "bg-cyan-500/10" },
  { label: "Search GitHub", description: "Discover MCP servers", icon: Search, path: "/discovery", color: "text-emerald-400", bg: "bg-emerald-500/10" },
];

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: status } = useScanStatus();
  const { data: runtime } = useRuntimeConfig();
  const { data: entities } = useEntities();
  const { data: projects } = useProjects();
  const rescan = useRescan();
  const { data: liveData } = useLiveData();
  const { data: settings } = useAppSettings();
  const { data: costData } = useQuery<any>({ queryKey: ["/api/analytics/costs"], staleTime: 300_000 });
  const { data: insightsData } = useQuery<{ insights: any[] }>({ queryKey: ["/api/analytics/insights"], staleTime: 300_000 });

  const counts = (status?.entityCounts || {}) as Record<string, number>;
  const activeSessions = liveData?.stats?.activeSessionCount || 0;

  // Session stats from projects
  const totalSessions = (projects || []).reduce((sum, p) => sum + (p.data.sessionCount || 0), 0);
  const totalSessionSize = (projects || []).reduce((sum, p) => sum + (p.data.sessionSize || 0), 0);

  // Recent changes (sorted by lastModified)
  const recentEntities = (entities || [])
    .filter((e) => e.lastModified)
    .sort((a, b) => (b.lastModified! > a.lastModified! ? 1 : -1))
    .slice(0, 10);

  // Entity color for border
  const entityBorderColor: Record<string, string> = {
    project: "border-l-blue-500 shadow-[inset_4px_0_8px_-4px_rgba(59,130,246,0.15)]",
    mcp: "border-l-green-500 shadow-[inset_4px_0_8px_-4px_rgba(34,197,94,0.15)]",
    skill: "border-l-orange-500 shadow-[inset_4px_0_8px_-4px_rgba(249,115,22,0.15)]",
    plugin: "border-l-purple-500 shadow-[inset_4px_0_8px_-4px_rgba(168,85,247,0.15)]",
    markdown: "border-l-slate-500 shadow-[inset_4px_0_8px_-4px_rgba(100,116,139,0.15)]",
    config: "border-l-teal-500 shadow-[inset_4px_0_8px_-4px_rgba(20,184,166,0.15)]",
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gradient">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {status?.totalEntities || 0} entities across {Object.keys(counts).length} types
            </p>
          </div>
          <MoodPlayerButton />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="gap-2 border-blue-500/30 hover:bg-blue-500/10 hover:border-blue-500/50 hover:shadow-glow transition-all"
        >
          <RefreshCw className={`h-3.5 w-3.5 transition-transform ${rescan.isPending ? "animate-spin" : ""}`} />
          {rescan.isPending ? "Scanning..." : "Rescan"}
        </Button>
      </div>

      {/* System health row */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border border-border/50 status-panel">
        <span className="text-xs font-semibold text-blue-400/80 uppercase tracking-wider">System</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-glow-pulse shadow-glow-green" />
          <span className="text-xs text-muted-foreground">Server</span>
        </div>
        <div className="flex items-center gap-1.5">
          {status?.scanning ? (
            <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-green-500 animate-glow-pulse shadow-glow-green" />
          )}
          <span className="text-xs text-muted-foreground">Scanner</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-glow-pulse shadow-glow-green" />
          <span className="text-xs text-muted-foreground">Watcher</span>
        </div>
        {activeSessions > 0 && (
          <button onClick={() => setLocation("/live")} className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-green-400 font-medium">{activeSessions} active session{activeSessions !== 1 ? "s" : ""}</span>
          </button>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground font-mono">
          {status?.lastScanAt ? `Last scan: ${relativeTime(status.lastScanAt)}` : ""}
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {entityTypes.map((type, i) => (
          <div key={type} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
            <StatCard
              type={type}
              count={counts[type] || 0}
              onClick={() => setLocation(type === "markdown" ? "/markdown" : type === "config" ? "/config" : `/${type}s`)}
            />
          </div>
        ))}
      </div>

      {/* Usage Overview */}
      {costData && (
        <Card className="animate-fade-in-up">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gauge className="h-4 w-4 text-blue-400" />
              Usage
              <button onClick={() => setLocation("/stats")} className="ml-auto text-[10px] text-muted-foreground hover:text-blue-400 transition-colors">View details</button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const daily = costData.dailyCosts || [];
              const today = new Date().toISOString().slice(0, 10);
              const todayCost = daily.find((d: any) => d.date === today)?.cost || 0;

              // This week (since Monday)
              const now = new Date();
              const dayOfWeek = now.getDay();
              const monday = new Date(now);
              monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7));
              const mondayStr = monday.toISOString().slice(0, 10);
              const weekCost = daily.filter((d: any) => d.date >= mondayStr).reduce((s: number, d: any) => s + d.cost, 0);
              const weekTokens = daily.filter((d: any) => d.date >= mondayStr).reduce((s: number, d: any) => s + d.inputTokens + d.outputTokens, 0);

              const totalCost = costData.totalCost || 0;
              const byModel = costData.byModel || {};
              const budget = settings?.monthlyBudget || null;

              // Active sessions cost
              const activeCost = liveData?.activeSessions?.reduce((s: number, se: any) => s + (se.costEstimate || 0), 0) || 0;

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Today */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Today</span>
                      <span className="text-sm font-mono font-bold text-blue-400">${todayCost.toFixed(2)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400" style={{ width: `${Math.min((todayCost / 20) * 100, 100)}%` }} />
                    </div>
                  </div>

                  {/* This Week */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">This week</span>
                      <span className="text-sm font-mono font-bold text-purple-400">${weekCost.toFixed(2)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-purple-400" style={{ width: `${Math.min((weekCost / 100) * 100, 100)}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground/50">{(weekTokens / 1_000_000).toFixed(1)}M tokens</span>
                  </div>

                  {/* All Time / Budget */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {budget ? `Budget ($${budget})` : "All time (30d)"}
                      </span>
                      <span className={`text-sm font-mono font-bold ${budget && totalCost > budget ? "text-red-400" : "text-amber-400"}`}>${totalCost.toFixed(2)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                      <div className={`h-full rounded-full ${budget && totalCost > budget * 0.8 ? "bg-gradient-to-r from-red-500 to-red-400" : "bg-gradient-to-r from-amber-500 to-amber-400"}`} style={{ width: `${Math.min((totalCost / (budget || 200)) * 100, 100)}%` }} />
                    </div>
                    {activeCost > 0 && <span className="text-[10px] text-green-400">${activeCost.toFixed(2)} active now</span>}
                  </div>

                  {/* By Model */}
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">By model</span>
                    {Object.entries(byModel).map(([model, data]: [string, any]) => (
                      <div key={model} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 w-14 justify-center">
                          {model}
                        </Badge>
                        <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${model === "opus" ? "bg-purple-500" : model === "sonnet" ? "bg-blue-500" : "bg-green-500"}`}
                            style={{ width: `${totalCost > 0 ? (data.cost / totalCost) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">${data.cost.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Insights */}
      {insightsData?.insights && insightsData.insights.length > 0 && (
        <div className="space-y-2 animate-fade-in-up">
          {insightsData.insights.map((insight: any, i: number) => (
            <div
              key={i}
              className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
                insight.severity === "critical" ? "border-red-500/30 bg-red-500/5" :
                insight.severity === "warning" ? "border-amber-500/30 bg-amber-500/5" :
                "border-blue-500/20 bg-blue-500/5"
              }`}
            >
              <span className={`text-sm mt-0.5 ${
                insight.severity === "critical" ? "text-red-400" :
                insight.severity === "warning" ? "text-amber-400" :
                "text-blue-400"
              }`}>
                {insight.type === "optimization" ? <Zap className="h-4 w-4" /> :
                 insight.type === "anomaly" ? <AlertCircle className="h-4 w-4" /> :
                 insight.type === "budget" ? <BarChart3 className="h-4 w-4" /> :
                 <Activity className="h-4 w-4" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{insight.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{insight.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions + Session Stats row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick Actions */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {quickActions.map((action) => (
              <button
                key={action.path}
                onClick={() => {
                  if (action.path.startsWith("/api/")) {
                    window.open(action.path, "_blank");
                  } else {
                    setLocation(action.path);
                  }
                }}
                className="flex items-center gap-2.5 rounded-lg border border-border/50 px-3 py-3 text-xs hover:bg-accent/50 hover:scale-[1.02] transition-all text-left group gradient-border"
              >
                <div className={`rounded-lg p-1.5 ${action.bg} transition-transform group-hover:scale-110`}>
                  <action.icon className={`h-3.5 w-3.5 ${action.color} transition-transform group-hover:-translate-y-0.5`} />
                </div>
                <div className="min-w-0">
                  <span className="font-medium block">{action.label}</span>
                  <span className="text-[10px] text-muted-foreground">{action.description}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Session Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              <button
                onClick={() => setLocation("/sessions")}
                className="hover:text-blue-400 transition-colors"
              >
                Sessions
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total sessions</span>
              <span className="font-mono font-semibold">{totalSessions.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Storage used</span>
              <span className="font-mono font-semibold">{formatBytes(totalSessionSize)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Projects</span>
              <span className="font-mono font-semibold">{(projects || []).length}</span>
            </div>
            {/* Mini breakdown */}
            <div className="pt-2 border-t border-border/50 space-y-1.5">
              {(projects || []).map((p) => (
                <button
                  key={p.id}
                  className="flex justify-between text-xs w-full hover:bg-accent/30 -mx-1 px-1 rounded transition-colors"
                  onClick={() => setLocation(`/projects/${p.id}`)}
                >
                  <span className="text-muted-foreground truncate mr-2">{p.name}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {p.data.sessionCount}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Runtime + Scanner combined */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              System
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {runtime ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <div className="rounded-md bg-muted/30 p-1"><Cpu className="h-3 w-3" /></div> Node
                  </span>
                  <span className="font-mono text-xs">{runtime.nodeVersion}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <div className="rounded-md bg-muted/30 p-1"><HardDrive className="h-3 w-3" /></div> Platform
                  </span>
                  <span className="font-mono text-xs">{runtime.platform}/{runtime.arch}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <div className="rounded-md bg-muted/30 p-1"><Database className="h-3 w-3" /></div> Memory
                  </span>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const rss = runtime.memoryUsage?.rss || 0;
                      const rssMB = Math.round(rss / 1048576);
                      const ceiling = 512; // MB — reasonable ceiling for Node process
                      const pct = Math.min(Math.round((rssMB / ceiling) * 100), 100);
                      const circumference = 2 * Math.PI * 13;
                      const color = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e";
                      return (
                        <div className="flex items-center gap-2" title={`${rssMB} MB RSS / ${ceiling} MB ceiling`}>
                          <svg className="h-8 w-8" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="13" fill="none" stroke="hsl(var(--muted) / 0.5)" strokeWidth="2.5" />
                            <circle
                              cx="18" cy="18" r="13" fill="none"
                              stroke={color} strokeWidth="2.5"
                              strokeDasharray={circumference}
                              strokeDashoffset={circumference - (circumference * pct / 100)}
                              strokeLinecap="round"
                              className="memory-ring-track"
                              transform="rotate(-90 18 18)"
                            />
                            <text x="18" y="19.5" textAnchor="middle" className="fill-foreground text-[7px] font-mono font-bold">{rssMB}</text>
                          </svg>
                          <span className="font-mono text-xs">{rssMB} MB</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-muted-foreground text-xs">Loading...</div>
            )}
            <div className="pt-2 border-t border-border/50">
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Last scan
                </span>
                <span className="font-mono text-xs">
                  {status?.lastScanAt ? relativeTime(status.lastScanAt) : "never"}
                </span>
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-muted-foreground">Entities / Relationships</span>
                <span className="font-mono text-xs">{status?.totalEntities || 0} / {status?.totalRelationships || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Keyboard Shortcuts Hint */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("toggle-shortcuts-overlay"))}
        className="flex items-center gap-3 px-4 py-2 rounded-lg border border-border/30 bg-card/30 hover:bg-card/50 transition-colors w-full text-left"
      >
        <Keyboard className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-[11px] text-muted-foreground/50">
          Press <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px] font-mono">?</kbd> for all keyboard shortcuts
          <span className="mx-2 text-border">|</span>
          <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px] font-mono">Ctrl+K</kbd> search
          <span className="mx-2 text-border">|</span>
          <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px] font-mono">G</kbd> then
          <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px] font-mono">D</kbd> /
          <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px] font-mono">S</kbd> /
          <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px] font-mono">G</kbd> /
          <kbd className="px-1 py-0.5 rounded border border-border/50 text-[10px] font-mono">L</kbd> navigate
        </span>
      </button>

      {/* Recent Changes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent Changes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentEntities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent changes detected</p>
          ) : (
            <div className="space-y-1">
              {recentEntities.map((entity, i) => (
                <button
                  key={entity.id}
                  className={`flex items-center gap-3 py-2.5 w-full text-left hover:bg-accent/30 -mx-2 px-2 rounded-md transition-colors border-l-[3px] animate-fade-in-up ${entityBorderColor[entity.type] || "border-l-transparent"}`}
                  style={{ animationDelay: `${i * 30}ms` }}
                  onClick={() => {
                    if (entity.type === "markdown") setLocation(`/markdown`);
                    else if (entity.type === "project") setLocation(`/projects/${entity.id}`);
                    else if (entity.type === "mcp") setLocation(`/mcps`);
                    else if (entity.type === "skill") setLocation(`/skills`);
                    else if (entity.type === "plugin") setLocation(`/plugins`);
                    else if (entity.type === "config") setLocation(`/config`);
                  }}
                >
                  <EntityIcon type={entity.type} className="h-4 w-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{entity.name}</span>
                    {entity.description && (
                      <p className="text-[11px] text-muted-foreground truncate">{entity.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entity.type}</Badge>
                    <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {entity.lastModified ? relativeTime(entity.lastModified) : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
