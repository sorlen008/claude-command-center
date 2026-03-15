import { useLocation } from "wouter";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EntityIcon, entityConfig } from "@/components/entity-badge";
import { useScanStatus, useRescan, useRuntimeConfig, useEntities, useProjects } from "@/hooks/use-entities";
import {
  RefreshCw, Clock, HardDrive, Cpu, Activity, Database,
  FolderOpen, Server, Wand2, FileText, GitBranch, Search,
  ExternalLink, BarChart3, Zap, CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";
import type { EntityType } from "@shared/types";

const entityTypes: EntityType[] = ["project", "mcp", "skill", "plugin", "markdown", "config"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const quickActions = [
  { label: "View Graph", description: "Explore entity relationships", icon: GitBranch, path: "/graph", color: "text-indigo-400", bg: "bg-indigo-500/10" },
  { label: "Search GitHub", description: "Discover MCP servers", icon: Search, path: "/discovery", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { label: "Edit CLAUDE.md", description: "Project instructions", icon: FileText, path: "/markdown", color: "text-blue-400", bg: "bg-blue-500/10" },
  { label: "MCP Servers", description: "Manage connections", icon: Server, path: "/mcps", color: "text-green-400", bg: "bg-green-500/10" },
];

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: status } = useScanStatus();
  const { data: runtime } = useRuntimeConfig();
  const { data: entities } = useEntities();
  const { data: projects } = useProjects();
  const rescan = useRescan();

  const counts = (status?.entityCounts || {}) as Record<string, number>;

  // Session stats from projects
  const totalSessions = (projects || []).reduce((sum, p) => sum + ((p.data as any).sessionCount || 0), 0);
  const totalSessionSize = (projects || []).reduce((sum, p) => sum + ((p.data as any).sessionSize || 0), 0);

  // Recent changes (sorted by lastModified)
  const recentEntities = (entities || [])
    .filter((e) => e.lastModified)
    .sort((a, b) => (b.lastModified! > a.lastModified! ? 1 : -1))
    .slice(0, 10);

  // Entity color for border
  const entityBorderColor: Record<string, string> = {
    project: "border-l-blue-500",
    mcp: "border-l-green-500",
    skill: "border-l-orange-500",
    plugin: "border-l-purple-500",
    markdown: "border-l-slate-500",
    config: "border-l-teal-500",
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {status?.totalEntities || 0} entities across {Object.keys(counts).length} types
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${rescan.isPending ? "animate-spin" : ""}`} />
          {rescan.isPending ? "Scanning..." : "Rescan"}
        </Button>
      </div>

      {/* System health row */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border border-border/50 bg-card/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">System</span>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 pulse-ring" style={{ color: "#22c55e40" }} />
          <span className="text-xs text-muted-foreground">Server</span>
        </div>
        <div className="flex items-center gap-1.5">
          {status?.scanning ? (
            <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-green-500" />
          )}
          <span className="text-xs text-muted-foreground">Scanner</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs text-muted-foreground">Watcher</span>
        </div>
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
          <CardContent className="grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <button
                key={action.path}
                onClick={() => setLocation(action.path)}
                className="flex items-center gap-2.5 rounded-lg border border-border/50 px-3 py-3 text-xs hover:bg-accent/50 hover:scale-[1.02] transition-all text-left group"
              >
                <div className={`rounded-lg p-1.5 ${action.bg}`}>
                  <action.icon className={`h-3.5 w-3.5 ${action.color}`} />
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
                    {(p.data as any).sessionCount}
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
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Cpu className="h-3 w-3" /> Node
                  </span>
                  <span className="font-mono text-xs">{runtime.nodeVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <HardDrive className="h-3 w-3" /> Platform
                  </span>
                  <span className="font-mono text-xs">{runtime.platform}/{runtime.arch}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Database className="h-3 w-3" /> Memory
                  </span>
                  <span className="font-mono text-xs">{Math.round(runtime.memoryUsage?.rss / 1048576)} MB</span>
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
