import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useLiveData } from "@/hooks/use-agents";
import { useTogglePin, useSaveSessionTitle } from "@/hooks/use-sessions";
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
  HelpCircle,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Lightbulb,
  Zap,
  ArrowRight,
  Pin,
  Minimize2,
  Copy,
  Pencil,
  X,
  Power,
  MessageSquare,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

/** Collapsible guide: Context & Session Tips
 *  SYNC: keep the "context bar" concept aligned with the Live category in
 *  client/src/pages/help.tsx. The new-user-safety test grep-asserts that both
 *  files mention the term — update both when editing.
 */
function SessionContextGuide({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5">
      <div className="flex items-center">
        <button onClick={onToggle} className="flex-1 flex items-center gap-2 px-4 py-3 text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
          <HelpCircle className="h-4 w-4" />
          Context & Session Tips
          {show ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
        </button>
        <a
          href="/help#live"
          onClick={(e) => e.stopPropagation()}
          className="text-[11px] text-cyan-400/70 hover:text-cyan-300 hover:underline px-3 py-3 shrink-0"
          title="Open the full Live View guide in Help Center"
        >
          Full guide →
        </a>
      </div>
      {show && (
        <div className="px-4 pb-4 space-y-4 text-sm border-t border-cyan-500/10 pt-3">

          {/* Context bar explained */}
          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">What the context bar means</h4>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              The context bar shows how much of the model's memory window is used. Every message, tool result, and system instruction takes up space. When it fills up, Claude starts compressing older messages to make room.
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-16 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full w-[25%] bg-green-500 rounded-full" /></div>
                <span className="text-[11px] text-green-400 font-medium">0–40%</span>
                <span className="text-[11px] text-muted-foreground">Plenty of room. Full conversation history available.</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-16 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full w-[60%] bg-amber-500 rounded-full" /></div>
                <span className="text-[11px] text-amber-400 font-medium">40–70%</span>
                <span className="text-[11px] text-muted-foreground">Getting full. Earlier tool results may be summarized.</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-16 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full w-[85%] bg-red-500 rounded-full" /></div>
                <span className="text-[11px] text-red-400 font-medium">70%+</span>
                <span className="text-[11px] text-muted-foreground">Compression active. Older messages being summarized.</span>
              </div>
            </div>
          </div>

          {/* What happens during compression */}
          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">What happens when context fills up</h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li className="flex gap-2"><ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-amber-400" />Claude compresses earlier conversation history (you'll see "prior messages compressed" notes)</li>
              <li className="flex gap-2"><ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-amber-400" />Tool results from early in the session get summarized or dropped</li>
              <li className="flex gap-2"><ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-green-400" />Recent messages and system instructions (CLAUDE.md, memory) are always preserved</li>
              <li className="flex gap-2"><ArrowRight className="h-3 w-3 mt-0.5 flex-shrink-0 text-green-400" />The session keeps working — it doesn't crash or stop</li>
            </ul>
          </div>

          {/* When to act */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <p className="text-amber-400 font-medium text-xs mb-1.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Signs to start a new session</p>
              <ul className="text-muted-foreground text-[11px] space-y-0.5">
                <li>Claude re-reads files it already read earlier</li>
                <li>It forgets decisions you made together</li>
                <li>Repeats questions you already answered</li>
                <li>The original task is done, moving to new work</li>
              </ul>
            </div>
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-2.5">
              <p className="text-green-400 font-medium text-xs mb-1.5 flex items-center gap-1"><Lightbulb className="h-3 w-3" /> When to keep going</p>
              <ul className="text-muted-foreground text-[11px] space-y-0.5">
                <li>Mid-task and context still coherent</li>
                <li>Claude still references earlier work correctly</li>
                <li>Starting fresh would lose important context</li>
                <li>Using 1M context model (much more headroom)</li>
              </ul>
            </div>
          </div>

          {/* Before ending a session */}
          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-cyan-400" /> Before ending a high-context session
            </h4>
            <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside">
              <li>Commit any work in progress to git</li>
              <li>Ask Claude to save important decisions or lessons to memory</li>
              <li>Check that tests pass and nothing is left broken</li>
              <li>Note the session slug so you can <code className="text-[11px] bg-muted/50 px-1 rounded">--resume</code> it later if needed</li>
            </ol>
          </div>

          {/* Session statuses */}
          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">Session statuses</h4>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="text-green-400 font-medium">Thinking</span><span className="text-muted-foreground">— Claude is actively generating a response</span></div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-amber-400 font-medium">Waiting</span><span className="text-muted-foreground">— Waiting for user input or tool approval</span></div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-muted-foreground/50" /><span className="text-muted-foreground font-medium">Idle</span><span className="text-muted-foreground">— No activity in the last 60 seconds</span></div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-muted-foreground/20" /><span className="text-muted-foreground/60 font-medium">Stale</span><span className="text-muted-foreground">— Process exists but session file is old</span></div>
            </div>
          </div>

          {/* Model context limits */}
          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">Model context limits</h4>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <div className="rounded border border-purple-500/20 bg-purple-500/5 p-2 text-center">
                <p className="text-purple-400 font-medium">Opus</p>
                <p className="text-lg font-bold font-mono">200k</p>
                <p className="text-[10px] text-muted-foreground">Deep reasoning</p>
              </div>
              <div className="rounded border border-blue-500/20 bg-blue-500/5 p-2 text-center">
                <p className="text-blue-400 font-medium">Sonnet</p>
                <p className="text-lg font-bold font-mono">200k</p>
                <p className="text-[10px] text-muted-foreground">Balanced speed/quality</p>
              </div>
              <div className="rounded border border-green-500/20 bg-green-500/5 p-2 text-center">
                <p className="text-green-400 font-medium">Opus 1M</p>
                <p className="text-lg font-bold font-mono">1000k</p>
                <p className="text-[10px] text-muted-foreground">Extended context</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Live() {
  const { data, isLoading, dataUpdatedAt, refetch } = useLiveData();
  const togglePin = useTogglePin();
  const [, setLocation] = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [compactTarget, setCompactTarget] = useState<ActiveSession | null>(null);
  const [compactCopied, setCompactCopied] = useState(false);
  const [compactSending, setCompactSending] = useState(false);
  const [compactSendResult, setCompactSendResult] = useState<"sent" | "failed" | null>(null);
  const [compactDebug, setCompactDebug] = useState<string | null>(null);
  const [msgTarget, setMsgTarget] = useState<ActiveSession | null>(null);   // full-message dialog
  const [closeTarget, setCloseTarget] = useState<ActiveSession | null>(null); // end-session confirm
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [bgInfoOpen, setBgInfoOpen] = useState(false);  // "what is a background session?" explainer
  const tick = useTick(1000);
  const isCompact = new URLSearchParams(window.location.search).get("compact") === "true";
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

  const handleConfirmCompact = useCallback(() => {
    navigator.clipboard.writeText("/compact");
    setCompactCopied(true);
    setTimeout(() => {
      setCompactCopied(false);
      setCompactTarget(null);
    }, 1200);
  }, []);

  const handleSendToTerminal = useCallback(async () => {
    if (!compactTarget) return;
    setCompactSending(true);
    setCompactSendResult(null);
    setCompactDebug(null);
    try {
      const res = await fetch("/api/live/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: compactTarget.sessionId }),
      });
      const data = await res.json() as { success: boolean; message?: string; debug?: { code: number; out: string; err: string; pid: number } };
      setCompactSendResult(data.success ? "sent" : "failed");
      if (!data.success && data.debug) {
        setCompactDebug(`pid=${data.debug.pid} code=${data.debug.code} out="${data.debug.out}" err="${data.debug.err}"`);
      }
      if (data.success) {
        setTimeout(() => {
          setCompactSendResult(null);
          setCompactTarget(null);
          setCompactSending(false);
        }, 1800);
      } else {
        setCompactSending(false);
      }
    } catch {
      setCompactSendResult("failed");
      setCompactSending(false);
    }
  }, [compactTarget]);

  const handleConfirmClose = useCallback(async () => {
    if (!closeTarget) return;
    setClosing(true);
    setCloseError(null);
    try {
      const res = await fetch("/api/live/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: closeTarget.sessionId }),
      });
      const data = await res.json() as { success: boolean; message?: string };
      if (data.success) {
        setCloseTarget(null);
        refetch();
      } else {
        setCloseError(data.message || "Failed to end session");
      }
    } catch (e) {
      setCloseError((e as Error).message);
    } finally {
      setClosing(false);
    }
  }, [closeTarget, refetch]);

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

  // Collect all agents across all sessions for the dropdown
  const allAgents = activeSessions.flatMap(session =>
    session.activeAgents.map(agent => ({ agent, session }))
  );

  // Compact overlay mode: /live?compact=true
  if (isCompact) {
    const totalCost = activeSessions.reduce((sum, s) => sum + (s.costEstimate ?? 0), 0);
    return (
      <div className="p-3 space-y-2 max-w-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{activeSessions.length} session{activeSessions.length !== 1 ? "s" : ""}</span>
          <span className="text-lg font-mono font-bold text-green-400">${totalCost.toFixed(2)}</span>
        </div>
        {activeSessions.map(s => (
          <div key={s.sessionId} className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.status === "thinking" ? "bg-green-500 animate-pulse" : s.status === "waiting" ? "bg-amber-500" : "bg-muted"}`} />
            <span className="truncate flex-1 text-muted-foreground">{s.firstMessage?.slice(0, 40) || s.slug || s.sessionId.slice(0, 8)}</span>
            <span className="font-mono text-green-400 flex-shrink-0">${(s.costEstimate ?? 0).toFixed(2)}</span>
          </div>
        ))}
        <div className="text-[10px] text-muted-foreground/40 text-center">auto-refreshes every 3s</div>
      </div>
    );
  }

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
        <div className="relative">
          <button
            className="flex items-center gap-2 hover:bg-accent/30 -mx-1 px-1 rounded transition-colors"
            onClick={() => setShowAgents(!showAgents)}
          >
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              <span className="font-mono font-bold">{stats?.activeAgentCount ?? 0}</span>
              <span className="text-muted-foreground ml-1">agent{(stats?.activeAgentCount ?? 0) !== 1 ? "s" : ""}</span>
            </span>
            {allAgents.length > 0 && (
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${showAgents ? "rotate-180" : ""}`} />
            )}
          </button>
          {showAgents && allAgents.length > 0 && (
            <div className="absolute top-full left-0 mt-2 w-80 rounded-xl border bg-card shadow-lg z-50 p-3 space-y-2 animate-fade-in-up">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium px-1">
                Active Agents ({allAgents.length})
              </div>
              {allAgents.map(({ agent, session }) => (
                <div key={agent.agentId} className={`rounded-lg border px-3 py-2 ${agent.status === "running" ? "border-green-500/20 bg-green-500/5" : "border-border/30 bg-muted/20"}`}>
                  <div className="flex items-center gap-2">
                    {agent.status === "running" ? (
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse drop-shadow-[0_0_4px_rgba(34,197,94,0.5)]" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                    )}
                    <span className="text-xs font-medium truncate">{agent.slug || agent.agentId.slice(0, 10)}</span>
                    {agent.agentType && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${getTypeColor(agent.agentType)}`}>
                        {agent.agentType}
                      </Badge>
                    )}
                  </div>
                  {agent.task && (
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 ml-4">{agent.task}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 ml-4 text-[10px] text-muted-foreground/50">
                    {agent.model && <span>{shortModel(agent.model)}</span>}
                    {session.slug && <><span className="text-muted-foreground/20">|</span><span>{session.slug}</span></>}
                    {!session.slug && session.cwd && <><span className="text-muted-foreground/20">|</span><span className="font-mono">{session.cwd.split("/").pop()}</span></>}
                    <span className="text-muted-foreground/20">|</span>
                    <span>{relativeTime(agent.lastWriteTs)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
        {/* Live cost ticker */}
        {activeSessions.some(s => (s.costEstimate ?? 0) > 0) && (
          <>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-green-400">
                ${activeSessions.reduce((sum, s) => sum + (s.costEstimate ?? 0), 0).toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground">active spend</span>
            </div>
          </>
        )}
      </div>

      {/* Context & Session Tips */}
      <SessionContextGuide show={showGuide} onToggle={() => setShowGuide(!showGuide)} />

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active sessions — 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Active Sessions</h2>
            {activeSessions.length > 0 && (() => {
              const bg = activeSessions.filter(s => s.kind === "bg").length;
              const term = activeSessions.length - bg;
              return (
                <span className="text-[11px] text-muted-foreground/70">
                  {term} terminal{term !== 1 ? "s" : ""}{bg > 0 ? ` · ${bg} background` : ""}
                </span>
              );
            })()}
          </div>
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
                  onCompactClick={() => setCompactTarget(session)}
                  onOpenInSessions={() => setLocation(`/sessions?session=${session.sessionId}`)}
                  onShowMessage={() => setMsgTarget(session)}
                  onClose={() => { setCloseError(null); setCloseTarget(session); }}
                  onExplainBackground={() => setBgInfoOpen(true)}
                  isNew={newSessionIds.has(session.sessionId)}
                  copiedId={copiedId}
                  onCopyResume={handleCopyResume}
                  onTogglePin={(id) => togglePin.mutate(id)}
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

      {/* Compact context dialog */}
      <Dialog open={!!compactTarget} onOpenChange={(open) => { if (!open) { setCompactTarget(null); setCompactSendResult(null); setCompactSending(false); setCompactDebug(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Minimize2 className="h-4 w-4 text-purple-400" />
              Compact Conversation Context
            </DialogTitle>
            <DialogDescription className="sr-only">Explanation of Claude Code's /compact command</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Compacting asks Claude to replace the older messages in the current session with a short summary, freeing up context window space so the session can keep running.
            </p>
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">Keeps recent messages and current task intact</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="h-3.5 w-3.5 text-green-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">Preserves file references and key decisions</span>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">Older detail (tool outputs, early back-and-forth) is condensed and may lose nuance</span>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">Claude must be waiting at the prompt — won't work mid-response</span>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">Send to Terminal is Windows-only and targets whichever Terminal tab was last focused — switch to it first if you have multiple tabs</span>
              </div>
            </div>
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
              <p className="text-xs text-foreground/90 mb-1.5">
                <span className="font-semibold text-purple-400">How to run it:</span> click <span className="font-medium">Send to Terminal</span> below, or switch to your Claude Code terminal and type:
              </p>
              <code className="block text-xs font-mono bg-background/60 rounded px-2 py-1 text-purple-300">/compact</code>
              {compactTarget?.contextUsage && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  This session is at <span className="font-mono tabular-nums text-foreground">{compactTarget.contextUsage.percentage}%</span> context.
                </p>
              )}
            </div>
          </div>
          {compactDebug && (
            <div className="mx-6 mb-1 rounded bg-muted/50 border border-border/40 px-2 py-1.5">
              <p className="text-[10px] font-mono text-muted-foreground break-all">{compactDebug}</p>
            </div>
          )}
          <DialogFooter className="flex-row justify-between items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setCompactTarget(null); setCompactSendResult(null); setCompactSending(false); }}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleConfirmCompact}
              >
                {compactCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {compactCopied ? "Copied!" : "Copy /compact"}
              </Button>
              <Button
                size="sm"
                className={`gap-1.5 ${compactSendResult === "sent" ? "bg-green-600 hover:bg-green-700" : compactSendResult === "failed" ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700"} text-white`}
                onClick={handleSendToTerminal}
                disabled={compactSending || compactSendResult === "sent"}
                title="Activates your terminal window and types /compact — works when Claude is waiting for input"
              >
                {compactSending ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Sending...</>
                ) : compactSendResult === "sent" ? (
                  <><Check className="h-3.5 w-3.5" />Sent!</>
                ) : compactSendResult === "failed" ? (
                  <><AlertTriangle className="h-3.5 w-3.5" />Copy instead</>
                ) : (
                  <><Terminal className="h-3.5 w-3.5" />Send to Terminal</>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full message dialog — read the entire Started / Latest message */}
      <Dialog open={!!msgTarget} onOpenChange={(open) => { if (!open) setMsgTarget(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-cyan-400" />
              {msgTarget?.customName || msgTarget?.slug || msgTarget?.sessionId.slice(0, 8) + "…"}
            </DialogTitle>
            <DialogDescription className="sr-only">Full first and latest message for this session</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm max-h-[60vh] overflow-y-auto">
            {msgTarget?.lastMessage && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Latest message</p>
                <p className="whitespace-pre-wrap break-words text-foreground/90 bg-muted/30 rounded-lg p-3 border border-border/40">{msgTarget.lastMessage}</p>
              </div>
            )}
            {msgTarget?.firstMessage && msgTarget.firstMessage !== msgTarget.lastMessage && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Started with</p>
                <p className="whitespace-pre-wrap break-words text-foreground/80 bg-muted/20 rounded-lg p-3 border border-border/30">{msgTarget.firstMessage}</p>
              </div>
            )}
            {!msgTarget?.lastMessage && !msgTarget?.firstMessage && (
              <p className="text-muted-foreground">No message text available for this session.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { if (msgTarget) { const id = msgTarget.sessionId; setMsgTarget(null); setLocation(`/sessions?session=${id}`); } }}>
              Open in Sessions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End-session confirmation */}
      <Dialog open={!!closeTarget} onOpenChange={(open) => { if (!open && !closing) { setCloseTarget(null); setCloseError(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-4 w-4 text-red-400" />
              End this session?
            </DialogTitle>
            <DialogDescription className="sr-only">Confirm ending the running Claude session</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This stops the running Claude process
              {closeTarget ? <> (<span className="font-mono text-foreground">PID {closeTarget.pid}</span>)</> : null}
              {closeTarget?.kind === "bg" && closeTarget.jobName ? <> — the background job “{closeTarget.jobName}”</> : null}.
              The conversation transcript is <span className="text-foreground font-medium">kept</span> — it stays in Sessions/Messages and can be resumed later.
            </p>
            {closeError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">{closeError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" disabled={closing} onClick={() => { setCloseTarget(null); setCloseError(null); }}>Cancel</Button>
            <Button size="sm" disabled={closing} onClick={handleConfirmClose} className="bg-red-500/90 hover:bg-red-500 text-white gap-1.5">
              {closing ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Ending…</> : <><Power className="h-3.5 w-3.5" />End session</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "What is a background session?" explainer */}
      <Dialog open={bgInfoOpen} onOpenChange={setBgInfoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-purple-400" />
              What is a background session?
            </DialogTitle>
            <DialogDescription className="sr-only">Explanation of headless background Claude Code sessions</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              A <span className="text-foreground font-medium">background</span> (headless) session is a Claude Code run that has <span className="text-foreground font-medium">no terminal window</span>. It usually starts as a forked or delegated job — for example a task launched in the background, or a session started with <code className="text-[11px] font-mono bg-muted/60 rounded px-1">--fork-session</code>.
            </p>
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Bot className="h-3.5 w-3.5 text-purple-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">Runs and uses tokens even though you don't see a window for it</span>
              </div>
              <div className="flex items-start gap-2">
                <Monitor className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">You can't type into it directly the way you can with your open terminals</span>
              </div>
              <div className="flex items-start gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-cyan-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">Click its Started/Latest line to read what it's doing</span>
              </div>
              <div className="flex items-start gap-2">
                <Power className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/90">If you don't need it, use the End-session button to stop it (its transcript is kept)</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              That's why the header counts terminals and background sessions separately — so the number always matches the terminals you can actually see.
            </p>
          </div>
        </DialogContent>
      </Dialog>
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
  onTogglePin,
  onCompactClick,
  onOpenInSessions,
  onShowMessage,
  onClose,
  onExplainBackground,
}: {
  session: ActiveSession;
  index: number;
  tick: number;
  isNew: boolean;
  copiedId: string | null;
  onCopyResume: (id: string) => void;
  onTogglePin: (id: string) => void;
  onCompactClick: () => void;
  onOpenInSessions: () => void;
  onShowMessage: () => void;
  onClose: () => void;
  onExplainBackground: () => void;
}) {
  const fallbackTitle = session.slug || shortSummary(session.firstMessage, 5) || session.sessionId.slice(0, 12) + "...";
  const title = session.customName || fallbackTitle;
  const lastMsg = session.lastMessage ? shortSummary(session.lastMessage, 12) : null;
  const firstMsg = session.firstMessage ? shortSummary(session.firstMessage, 8) : null;
  const isCopied = copiedId === session.sessionId;
  const sc = getStatusConfig(session.status);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.customName || "");
  const saveTitle = useSaveSessionTitle();

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next === (session.customName || "")) {
      setEditingTitle(false);
      return;
    }
    saveTitle.mutate(
      { id: session.sessionId, title: next },
      { onSettled: () => setEditingTitle(false) }
    );
  };

  const clearTitle = () => {
    setTitleDraft("");
    saveTitle.mutate(
      { id: session.sessionId, title: "" },
      { onSettled: () => setEditingTitle(false) }
    );
  };

  return (
    <Card
      className={`animate-fade-in-up cursor-pointer hover:bg-accent/10 transition-colors ${sc.cardClass} ${sc.borderClass ? `border ${sc.borderClass}` : ""} ${isNew ? "ring-2 ring-green-500/40 shadow-[0_0_20px_rgba(34,197,94,0.2)]" : ""}`}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={(e) => {
        // Don't navigate when the click landed on a button, link, or any
        // interactive control inside the card. The card body itself is the
        // target — click anywhere "neutral" to open the session in Sessions.
        const t = e.target as HTMLElement;
        if (t.closest("button") || t.closest("a") || t.closest("input")) return;
        onOpenInSessions();
      }}
      title="Click to open in Sessions"
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
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  maxLength={80}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") commitTitle();
                    if (e.key === "Escape") { setTitleDraft(session.customName || ""); setEditingTitle(false); }
                  }}
                  onBlur={commitTitle}
                  placeholder="Custom name…"
                  className="flex-1 min-w-0 text-sm font-medium bg-background/60 border border-border/60 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-purple-400/60"
                />
              ) : (
                <span
                  className={`text-sm font-medium truncate ${session.customName ? "text-foreground" : ""}`}
                  title={session.customName ? `Custom name (original: ${fallbackTitle})` : title}
                >
                  {title}
                </span>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">PID {session.pid}</Badge>
              {session.kind === "bg" && (
                <Badge
                  onClick={(e) => { e.stopPropagation(); onExplainBackground(); }}
                  className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-purple-500/20 text-purple-300 border-purple-500/30 hover:bg-purple-500/30 gap-1 cursor-pointer"
                  title="What is a background session? (click to learn more)"
                >
                  <Bot className="h-2.5 w-2.5" /> BACKGROUND
                </Badge>
              )}
              {session.permissionMode === "bypass" && (
                <Badge className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20">BYPASS</Badge>
              )}
              {session.permissionMode === "auto-accept" && (
                <Badge className="text-[10px] px-1.5 py-0 flex-shrink-0 bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">AUTO</Badge>
              )}
              <div className="ml-auto flex-shrink-0 flex items-center gap-0.5">
                {editingTitle ? (
                  session.customName && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={(e) => { e.stopPropagation(); clearTitle(); }}
                      title="Clear custom name"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTitleDraft(session.customName || "");
                      setEditingTitle(true);
                    }}
                    title={session.customName ? "Rename session" : "Set custom name"}
                  >
                    <Pencil className={`h-3.5 w-3.5 ${session.customName ? "text-purple-400" : "text-muted-foreground"}`} />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => onTogglePin(session.sessionId)}
                  title={session.isPinned ? "Unpin session" : "Pin session"}
                >
                  <Pin className={`h-3.5 w-3.5 ${session.isPinned ? "text-amber-400 fill-amber-400" : "text-muted-foreground"}`} />
                </Button>
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 group/end"
                  onClick={(e) => { e.stopPropagation(); onClose(); }}
                  title="End session — stops the running process. Transcript is kept (resumable)."
                  aria-label="End session"
                >
                  <Power className="h-3.5 w-3.5 text-muted-foreground group-hover/end:text-red-400" />
                </Button>
              </div>
            </div>

            {/* Latest message — click to read the full text */}
            {lastMsg && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onShowMessage(); }}
                className="block w-full text-left mt-1 rounded hover:bg-muted/40 transition-colors cursor-pointer"
                title="Click to read the full message"
              >
                <p className="text-xs text-foreground/80 line-clamp-2">
                  <span className="text-[10px] text-muted-foreground/50 mr-1">Latest:</span>
                  {lastMsg}
                </p>
              </button>
            )}
            {/* First message (if different from last) */}
            {firstMsg && firstMsg !== lastMsg && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onShowMessage(); }}
                className="block w-full text-left mt-0.5 rounded hover:bg-muted/40 transition-colors cursor-pointer"
                title="Click to read the full message"
              >
                <p className="text-[11px] text-muted-foreground/60 truncate">
                  <span className="text-[10px] mr-1">Started:</span>
                  {firstMsg}
                </p>
              </button>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
              <Clock className="h-3 w-3 flex-shrink-0" />
              <span className="tabular-nums">{runningDuration(session.startedAt, tick)}</span>
              <span className="text-muted-foreground/30">|</span>
              <button
                className="font-mono text-[10px] text-muted-foreground/40 hover:text-blue-400 transition-colors"
                onClick={() => navigator.clipboard.writeText(session.sessionId)}
                title="Click to copy UUID"
              >{session.sessionId}</button>
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
              <div className="mt-2 flex items-center gap-2" title={`${session.contextUsage.tokensUsed.toLocaleString()} / ${session.contextUsage.usableTokens.toLocaleString()} usable tokens (${session.contextUsage.percentage}%) — ${session.contextUsage.maxTokens.toLocaleString()}-token window, ~21% reserved for output + auto-compact (matches the terminal meter)`}>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onCompactClick(); }}
                    className="h-5 px-1.5 inline-flex items-center gap-1 rounded-md border border-purple-500/40 bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 hover:border-purple-400/60 hover:text-purple-200 transition-colors"
                    title="Compact this conversation's context — copies /compact to your clipboard"
                    aria-label="Compact context"
                  >
                    <Minimize2 className="h-3 w-3" />
                    <span className="text-[10px] font-medium leading-none">Compact</span>
                  </button>
                  <span className="text-[10px] text-muted-foreground/60">Context</span>
                </div>
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
                  {Math.round(session.contextUsage.tokensUsed / 1000)}k / {Math.round(session.contextUsage.usableTokens / 1000)}k
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
