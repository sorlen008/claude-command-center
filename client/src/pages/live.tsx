import { useState } from "react";
import { useLiveData } from "@/hooks/use-agents";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/skeleton";
import {
  Radio,
  Bot,
  Monitor,
  Clock,
  RefreshCw,
  Cpu,
  Activity,
} from "lucide-react";
import type { ActiveSession, AgentExecution } from "@shared/types";

const AGENT_TYPE_COLORS: Record<string, string> = {
  Explore: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
  Plan: "border-blue-500/30 text-blue-400 bg-blue-500/10",
  "general-purpose": "border-amber-500/30 text-amber-400 bg-amber-500/10",
  "claude-code-guide": "border-violet-500/30 text-violet-400 bg-violet-500/10",
};

function getTypeColor(type: string | null): string {
  if (!type) return "border-muted-foreground/30 text-muted-foreground";
  return AGENT_TYPE_COLORS[type] || "border-cyan-500/30 text-cyan-400 bg-cyan-500/10";
}

function shortModel(model: string | null): string {
  if (!model) return "?";
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model.slice(0, 12);
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function runningDuration(startedAt: number): string {
  const diff = Date.now() - startedAt;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

export default function Live() {
  const { data, isLoading, dataUpdatedAt, refetch } = useLiveData();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    refetch().finally(() => setTimeout(() => setRefreshing(false), 500));
  };

  const lastUpdated = dataUpdatedAt ? relativeTime(new Date(dataUpdatedAt).toISOString()) : "-";

  if (isLoading) return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Live View</h1>
      </div>
      <ListSkeleton rows={4} />
    </div>
  );

  const stats = data?.stats;
  const activeSessions = data?.activeSessions || [];
  const recentActivity = data?.recentActivity || [];

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Live View</h1>
          {(stats?.activeSessionCount ?? 0) > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-green-400">Active</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Updated {lastUpdated}</span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-3 rounded-xl border bg-card">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">
            <span className="font-mono font-bold">{stats?.activeSessionCount ?? 0}</span>
            <span className="text-muted-foreground ml-1">session{(stats?.activeSessionCount ?? 0) !== 1 ? "s" : ""}</span>
          </span>
          {(stats?.activeSessionCount ?? 0) > 0 && (
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>
        <div className="w-px h-5 bg-border" />
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">
            <span className="font-mono font-bold">{stats?.activeAgentCount ?? 0}</span>
            <span className="text-muted-foreground ml-1">agent{(stats?.activeAgentCount ?? 0) !== 1 ? "s" : ""}</span>
          </span>
        </div>
        <div className="w-px h-5 bg-border" />
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Models:</span>
          {(stats?.modelsInUse || []).length > 0 ? (
            <div className="flex gap-1">
              {stats!.modelsInUse.map(m => (
                <Badge key={m} variant="outline" className="text-[10px] px-1.5 py-0">{shortModel(m)}</Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground/50">none</span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active sessions — 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active Sessions</h2>
          {activeSessions.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center">
              <Monitor className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No active Claude sessions</p>
              <p className="text-xs text-muted-foreground/50 mt-1">Sessions will appear here when Claude Code is running</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.map((session, i) => (
                <ActiveSessionCard key={session.sessionId} session={session} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* Recent activity — 1 col */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <div className="rounded-xl border bg-card p-6 text-center">
              <Activity className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No agents in the past hour</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-auto">
              {recentActivity.map((exec, i) => (
                <RecentActivityItem key={exec.agentId} exec={exec} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Today's summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Agents Today</p>
              <p className="text-2xl font-bold font-mono mt-1">{stats?.agentsToday ?? 0}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-2.5">
              <Bot className="h-5 w-5 text-cyan-400" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 animate-fade-in-up" style={{ animationDelay: "50ms" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Models Used</p>
              <p className="text-2xl font-bold font-mono mt-1">{(stats?.modelsInUse || []).length}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-2.5">
              <Cpu className="h-5 w-5 text-purple-400" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4 animate-fade-in-up" style={{ animationDelay: "100ms" }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Active Sessions</p>
              <p className="text-2xl font-bold font-mono mt-1">{stats?.activeSessionCount ?? 0}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-2.5">
              <Monitor className="h-5 w-5 text-green-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveSessionCard({ session, index }: { session: ActiveSession; index: number }) {
  return (
    <Card className="animate-fade-in-up" style={{ animationDelay: `${index * 50}ms` }}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="mt-1 w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium font-mono">{session.sessionId.slice(0, 12)}...</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">PID {session.pid}</Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <span className="font-mono truncate max-w-[300px]">{session.cwd.replace(/\\/g, "/")}</span>
              <span className="text-muted-foreground/30">/</span>
              <Clock className="h-3 w-3" />
              <span>{runningDuration(session.startedAt)}</span>
            </div>

            {/* Active agents */}
            {session.activeAgents.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Active Agents ({session.activeAgents.length})
                </span>
                {session.activeAgents.map(agent => (
                  <div key={agent.agentId} className="flex items-center gap-2 text-xs ml-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                    {agent.agentType && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${getTypeColor(agent.agentType)}`}>
                        {agent.agentType}
                      </Badge>
                    )}
                    <span className="font-mono">{agent.slug || agent.agentId.slice(0, 12)}</span>
                    {agent.model && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{shortModel(agent.model)}</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentActivityItem({ exec, index }: { exec: AgentExecution; index: number }) {
  return (
    <div
      className="rounded-lg border bg-card p-3 animate-fade-in-up"
      style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
    >
      <div className="flex items-start gap-2">
        <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0 w-12 mt-0.5">
          {relativeTime(exec.firstTs)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {exec.agentType && (
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${getTypeColor(exec.agentType)}`}>
                {exec.agentType}
              </Badge>
            )}
            <span className="text-xs font-mono truncate">{exec.slug || exec.agentId.slice(0, 8)}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{exec.firstMessage || "(no message)"}</p>
        </div>
      </div>
    </div>
  );
}
