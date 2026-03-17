import { useState, useEffect, useRef, useCallback } from "react";
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
  Terminal,
  Check,
  GitBranch,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { ActiveSession, AgentExecution } from "@shared/types";
import { relativeTime as _relativeTime, shortModel, getTypeColor } from "@/lib/utils";

const REFETCH_MS = 3000;

const relativeTime = (dateStr: string | null) => dateStr ? _relativeTime(dateStr) : "-";

function runningDuration(startedAt: number, _tick?: number): string {
  const diff = Date.now() - startedAt;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function shortSummary(msg: string | undefined, maxWords = 5): string {
  if (!msg) return "";
  const words = msg.trim().split(/\s+/).slice(0, maxWords);
  let result = words.join(" ");
  if (msg.trim().split(/\s+/).length > maxWords) result += "...";
  return result;
}

/** Returns Date.now() every `ms` milliseconds for ticking UIs */
function useTick(ms: number): number {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

const STATUS_CONFIG: Record<string, { dotClass: string; borderClass: string; cardClass: string; label: string }> = {
  thinking: {
    dotClass: "bg-green-500 animate-pulse drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]",
    borderClass: "border-green-500/20",
    cardClass: "",
    label: "Thinking",
  },
  waiting: {
    dotClass: "bg-yellow-500 drop-shadow-[0_0_4px_rgba(234,179,8,0.5)]",
    borderClass: "border-yellow-500/20",
    cardClass: "",
    label: "Waiting",
  },
  idle: {
    dotClass: "bg-muted-foreground/50",
    borderClass: "",
    cardClass: "",
    label: "Idle",
  },
  stale: {
    dotClass: "bg-muted-foreground/30",
    borderClass: "",
    cardClass: "opacity-60",
    label: "Stale",
  },
};

function getStatusConfig(status?: string) {
  return STATUS_CONFIG[status || ""] || STATUS_CONFIG.stale;
}

export default function Live() {
  const { data, isLoading, dataUpdatedAt, refetch } = useLiveData();
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const tick = useTick(1000);
  const prevSessionIdsRef = useRef<Set<string> | null>(null);
  const [newSessionIds, setNewSessionIds] = useState<Set<string>>(new Set());

  const activeSessions = data?.activeSessions || [];

  // Track new sessions for highlight glow
  useEffect(() => {
    const currentIds = new Set(activeSessions.map(s => s.sessionId));
    if (prevSessionIdsRef.current !== null) {
      const fresh = new Set<string>();
      activeSessions.forEach(s => {
        if (!prevSessionIdsRef.current!.has(s.sessionId)) fresh.add(s.sessionId);
      });
      if (fresh.size > 0) {
        setNewSessionIds(fresh);
        const timer = setTimeout(() => setNewSessionIds(new Set()), 3000);
        return () => clearTimeout(timer);
      }
    }
    prevSessionIdsRef.current = currentIds;
  }, [activeSessions]);

  const handleRefresh = () => {
    setRefreshing(true);
    refetch().finally(() => setTimeout(() => setRefreshing(false), 500));
  };

  const handleCopyResume = useCallback((sessionId: string) => {
    navigator.clipboard.writeText(`claude --resume ${sessionId}`);
    setCopiedId(sessionId);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  // Countdown to next refresh
  const secsSinceUpdate = dataUpdatedAt ? Math.floor((tick - dataUpdatedAt) / 1000) : 0;
  const nextIn = Math.max(0, Math.ceil((REFETCH_MS - (tick - (dataUpdatedAt || tick))) / 1000));

  if (isLoading) return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Live View</h1>
      </div>
      <ListSkeleton rows={4} />
    </div>
  );

  const stats = data?.stats;
  const recentActivity = data?.recentActivity || [];
  const hasActive = (stats?.activeSessionCount ?? 0) > 0;

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Live View</h1>
          {hasActive && (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]" />
              <span className="text-sm text-green-400">Active</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            next in {nextIn}s
          </span>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Status bar */}
      <div className={`flex items-center gap-4 px-4 py-3 rounded-xl border bg-card ${hasActive ? "live-border border-green-500/20 shadow-[0_0_20px_rgba(34,197,94,0.08)]" : ""}`}>
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          {(() => {
            const thinkingCount = activeSessions.filter(s => s.status === "thinking").length;
            const waitingCount = activeSessions.filter(s => s.status === "waiting").length;
            const idleCount = activeSessions.filter(s => s.status === "idle").length;
            const staleCount = activeSessions.filter(s => s.status === "stale").length;
            const noStatusCount = activeSessions.filter(s => !s.status).length;
            const total = stats?.activeSessionCount ?? 0;
            const parts: string[] = [];
            if (thinkingCount + noStatusCount > 0) parts.push(`${thinkingCount + noStatusCount} thinking`);
            if (waitingCount > 0) parts.push(`${waitingCount} waiting`);
            if (idleCount > 0) parts.push(`${idleCount} idle`);
            if (staleCount > 0) parts.push(`${staleCount} stale`);
            return (
              <span className="text-sm">
                <span className="font-mono font-bold">{total}</span>
                <span className="text-muted-foreground ml-1">
                  {total !== 1 ? "sessions" : "session"}
                  {parts.length > 0 && hasActive && ` — ${parts.join(", ")}`}
                </span>
              </span>
            );
          })()}
          {hasActive && (
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
            <div className="rounded-xl border bg-card">
              <EmptyState icon={Monitor} title="No active Claude sessions" description="Sessions will appear here when Claude Code is running" />
            </div>
          ) : (
            <div className="space-y-3">
              {activeSessions.map((session, i) => (
                <ActiveSessionCard
                  key={session.sessionId}
                  session={session}
                  index={i}
                  tick={tick}
                  isNew={newSessionIds.has(session.sessionId)}
                  copiedId={copiedId}
                  onCopyResume={handleCopyResume}
                />
              ))}
            </div>
          )}
        </div>

        {/* Recent activity — 1 col */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState icon={Activity} title="No agents in the past hour" />
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
        <div className="rounded-xl border bg-card p-4 animate-fade-in-up gradient-border">
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
        <div className="rounded-xl border bg-card p-4 animate-fade-in-up gradient-border" style={{ animationDelay: "50ms" }}>
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
        <div className="rounded-xl border bg-card p-4 animate-fade-in-up gradient-border" style={{ animationDelay: "100ms" }}>
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

function ActiveSessionCard({
  session,
  index,
  tick,
  isNew,
  copiedId,
  onCopyResume,
}: {
  session: ActiveSession;
  index: number;
  tick: number;
  isNew: boolean;
  copiedId: string | null;
  onCopyResume: (id: string) => void;
}) {
  const title = session.slug || shortSummary(session.firstMessage, 5) || session.sessionId.slice(0, 12) + "...";
  const lastMsg = session.lastMessage ? shortSummary(session.lastMessage, 12) : null;
  const firstMsg = session.firstMessage ? shortSummary(session.firstMessage, 8) : null;
  const isCopied = copiedId === session.sessionId;
  const sc = getStatusConfig(session.status);

  return (
    <Card
      className={`animate-fade-in-up ${sc.cardClass} ${sc.borderClass ? `border ${sc.borderClass}` : ""} ${isNew ? "ring-2 ring-green-500/40 shadow-[0_0_20px_rgba(34,197,94,0.2)]" : ""}`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-1 flex flex-col items-center gap-0.5 flex-shrink-0">
            <span className={`w-2.5 h-2.5 rounded-full ${sc.dotClass}`} />
            <span className="text-[9px] text-muted-foreground/60 leading-none">{sc.label}</span>
          </div>
          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{title}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">PID {session.pid}</Badge>
              {session.permissionMode === "bypass" && (
                <Badge className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20">BYPASS</Badge>
              )}
              {session.permissionMode === "auto-accept" && (
                <Badge className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">AUTO</Badge>
              )}
              <div className="ml-auto flex-shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => onCopyResume(session.sessionId)}
                  title="Copy resume command"
                >
                  {isCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>

            {/* Latest message */}
            {lastMsg && (
              <p className="text-xs text-foreground/80 mt-1 line-clamp-2">
                <span className="text-[10px] text-muted-foreground/50 mr-1">Latest:</span>
                {lastMsg}
              </p>
            )}
            {/* First message (if different from last) */}
            {firstMsg && firstMsg !== lastMsg && (
              <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                <span className="text-[10px] mr-1">Started:</span>
                {firstMsg}
              </p>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
              <Clock className="h-3 w-3 flex-shrink-0" />
              <span className="tabular-nums">{runningDuration(session.startedAt, tick)}</span>
              {session.contextUsage?.model && (
                <>
                  <span className="text-muted-foreground/30">|</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{shortModel(session.contextUsage.model)}</Badge>
                </>
              )}
              {(session.messageCount ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground/30">|</span>
                  <span className="tabular-nums">{session.messageCount} msgs</span>
                </>
              )}
              {(session.sizeBytes ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground/30">|</span>
                  <span className="tabular-nums">{session.sizeBytes! > 1048576 ? `${(session.sizeBytes! / 1048576).toFixed(1)} MB` : `${Math.round(session.sizeBytes! / 1024)} KB`}</span>
                </>
              )}
              {(session.costEstimate ?? 0) > 0 && (
                <>
                  <span className="text-muted-foreground/30">|</span>
                  <span className="tabular-nums text-amber-400/70">${session.costEstimate! < 0.01 ? "<0.01" : session.costEstimate!.toFixed(2)}</span>
                </>
              )}
              {session.projectKey && (
                <>
                  <span className="text-muted-foreground/30">|</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{session.projectKey.split("--").pop()}</Badge>
                </>
              )}
              {session.gitBranch && (
                <>
                  <span className="text-muted-foreground/30">|</span>
                  <GitBranch className="h-3 w-3 flex-shrink-0" />
                  <span className="tabular-nums">{session.gitBranch}</span>
                </>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground/40 mt-0.5 font-mono truncate">{session.cwd.replace(/\\/g, "/")}</div>

            {/* Context usage */}
            {session.contextUsage && (
              <div className="mt-2 flex items-center gap-2" title={`${session.contextUsage.tokensUsed.toLocaleString()} / ${session.contextUsage.maxTokens.toLocaleString()} tokens (${session.contextUsage.percentage}%)`}>
                <span className="text-[10px] text-muted-foreground/60 shrink-0 w-12">Context</span>
                <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full context-bar-fill"
                    style={{
                      width: `${Math.min(session.contextUsage.percentage, 100)}%`,
                      background: `linear-gradient(90deg, #22c55e, #f59e0b 60%, #ef4444)`,
                      backgroundSize: "200% 100%",
                      backgroundPosition: `${Math.min(session.contextUsage.percentage, 100)}% 0`,
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
                  {session.contextUsage.percentage}%
                </span>
                <span className="text-[9px] text-muted-foreground/40 shrink-0">
                  {Math.round(session.contextUsage.tokensUsed / 1000)}k / {Math.round(session.contextUsage.maxTokens / 1000)}k
                </span>
              </div>
            )}

            {/* Agents (running + recent) */}
            {session.activeAgents.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Agents ({session.activeAgents.filter(a => a.status === "running").length} running, {session.activeAgents.filter(a => a.status === "recent").length} recent)
                </span>
                {session.activeAgents.map(agent => (
                  <div key={agent.agentId} className={`rounded-md border px-2.5 py-1.5 ${agent.status === "running" ? "border-green-500/20 bg-green-500/5" : "border-border/30 bg-muted/20"}`}>
                    <div className="flex items-center gap-2 text-xs">
                      {agent.status === "running" ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0 drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 flex-shrink-0" />
                      )}
                      {agent.agentType && (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${getTypeColor(agent.agentType)}`}>
                          {agent.agentType}
                        </Badge>
                      )}
                      {agent.model && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{shortModel(agent.model)}</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground/50 ml-auto tabular-nums">
                        {relativeTime(agent.lastWriteTs)}
                      </span>
                    </div>
                    {agent.task && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 ml-3.5">{agent.task}</p>
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
