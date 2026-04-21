import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowRight, Gauge, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Click-to-open usage glance, modeled on Claude Code's native plan-usage popup.
 * Shows the three things a user actually cares about at any moment:
 *   1. Current session's context window fill (which session is eating its context)
 *   2. 5-hour window usage (personal ceiling if known, plan-based estimate otherwise)
 *   3. Rolling-7d weekly usage for Sonnet and Opus (when the plan publishes them)
 *
 * Polls every 15s so the numbers feel live without hammering the scanner.
 */

interface ActiveSessionLite {
  sessionId: string;
  slug?: string;
  customName?: string;
  status?: "thinking" | "waiting" | "idle" | "stale";
  contextUsage?: {
    tokensUsed: number;
    maxTokens: number;
    percentage: number;
    model?: string;
  };
}

interface LiveLite {
  activeSessions: ActiveSessionLite[];
}

interface HistoricalLimitsLite {
  medianTokens: number | null;
  p50Tokens: number | null;
  p90Tokens: number | null;
  sampleSize: number;
}

interface EstimatedCeilingLite {
  tokensPerSession: number | null;
  confidence: "estimate" | "unknown";
}

interface PeriodUsageLite {
  tokensUsed: number;
  costUsd: number;
  sonnetHours: number;
  opusHours: number;
}

interface PlanLite {
  id: string;
  label: string;
  payPerToken: boolean;
  sessionWindow: { durationHours: number };
  weekly: {
    sonnetHoursMin: number | null;
    sonnetHoursMax: number | null;
    opusHoursMin: number | null;
    opusHoursMax: number | null;
  };
}

interface PlanUsageLite {
  selectedPlanId: string | null;
  plan: PlanLite | null;
  billingModeDetected: "subscription" | "api" | "unknown";
  currentSession: { resetAtIso: string; tokensUsed: number; costUsd: number } | null;
  weekly: PeriodUsageLite | null;
  monthly: PeriodUsageLite | null;
  historicalLimits: HistoricalLimitsLite;
  estimatedCeiling: EstimatedCeilingLite;
}

interface SettingsLite { monthlyBudget?: number | null }

function fmtDelta(iso: string): string {
  const diffMs = Date.parse(iso) - Date.now();
  if (diffMs <= 0) return "now";
  const h = Math.floor(diffMs / (60 * 60 * 1000));
  const m = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const remH = h % 24;
    return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function colorFor(pct: number | null): string {
  if (pct === null) return "bg-muted-foreground/40";
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  if (pct >= 40) return "bg-yellow-500";
  return "bg-emerald-500";
}

function UsageRow({
  label,
  value,
  percent,
  sub,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  percent: number | null;
  sub?: React.ReactNode;
}) {
  const fillPct = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="text-muted-foreground truncate min-w-0">{label}</span>
        <span className="font-mono tabular-nums text-foreground/90 shrink-0">{value}</span>
      </div>
      <div className="h-1 rounded-full bg-muted/30 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", colorFor(percent))}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/60">{sub}</div>}
    </div>
  );
}

export function PlanUsagePopoverContent({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { data: planUsage } = useQuery<PlanUsageLite>({
    queryKey: ["/api/analytics/plan-usage"],
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const { data: live } = useQuery<LiveLite>({
    queryKey: ["/api/live"],
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const { data: settings } = useQuery<SettingsLite>({
    queryKey: ["/api/settings"],
    staleTime: 60_000,
  });

  // Pick the most meaningful active session for the Context row:
  // prefer thinking > waiting > idle > stale, break ties by highest context %.
  const activeSession = (() => {
    const sessions = (live?.activeSessions ?? []).filter(s => s.contextUsage);
    if (sessions.length === 0) return null;
    const statusRank: Record<string, number> = { thinking: 0, waiting: 1, idle: 2, stale: 3 };
    return sessions.slice().sort((a, b) => {
      const ra = statusRank[a.status ?? "stale"] ?? 4;
      const rb = statusRank[b.status ?? "stale"] ?? 4;
      if (ra !== rb) return ra - rb;
      return (b.contextUsage!.percentage) - (a.contextUsage!.percentage);
    })[0];
  })();

  const isApi = planUsage?.billingModeDetected === "api";
  const plan = planUsage?.plan ?? null;

  // --- Session ceiling basis
  const sessionTokens = planUsage?.currentSession?.tokensUsed ?? 0;
  const personalMedian = planUsage?.historicalLimits?.medianTokens ?? null;
  const sampleSize = planUsage?.historicalLimits?.sampleSize ?? 0;
  const estimateTokens = planUsage?.estimatedCeiling?.tokensPerSession ?? null;
  const ceilingValue = personalMedian && personalMedian > 0 ? personalMedian :
    estimateTokens && estimateTokens > 0 ? estimateTokens : null;
  const ceilingIsEstimate = !(personalMedian && personalMedian > 0) && !!(estimateTokens && estimateTokens > 0);
  const sessionPct = ceilingValue && ceilingValue > 0 ? (sessionTokens / ceilingValue) * 100 : null;

  // --- Weekly percentages (vs low-end of published range; early-warning bias)
  const weeklySonnetPct = plan?.weekly.sonnetHoursMin && planUsage?.weekly
    ? (planUsage.weekly.sonnetHours / plan.weekly.sonnetHoursMin) * 100
    : null;
  const weeklyOpusPct = plan?.weekly.opusHoursMin && planUsage?.weekly
    ? (planUsage.weekly.opusHours / plan.weekly.opusHoursMin) * 100
    : null;

  // --- API-mode monthly budget
  const monthlySpend = planUsage?.monthly?.costUsd ?? 0;
  const budget = settings?.monthlyBudget ?? null;
  const budgetPct = budget && budget > 0 ? (monthlySpend / budget) * 100 : null;

  return (
    <div className="space-y-4 min-w-[280px]">
      {/* --- Context window row --- */}
      {activeSession?.contextUsage && (
        <div className="space-y-1.5">
          <UsageRow
            label={
              <span className="flex items-center gap-1.5">
                <Gauge className="h-3 w-3 text-muted-foreground/70" />
                Context window
                {activeSession.status === "thinking" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </span>
            }
            value={
              <>
                {fmtTokens(activeSession.contextUsage.tokensUsed)} / {fmtTokens(activeSession.contextUsage.maxTokens)}
                <span className="text-muted-foreground/60"> ({activeSession.contextUsage.percentage}%)</span>
              </>
            }
            percent={activeSession.contextUsage.percentage}
            sub={
              <span className="truncate block">
                {activeSession.customName || activeSession.slug || activeSession.sessionId.slice(0, 8)}
                {activeSession.contextUsage.model && (
                  <span className="text-muted-foreground/40"> · {activeSession.contextUsage.model.replace(/^claude-/, "")}</span>
                )}
              </span>
            }
          />
        </div>
      )}
      {!activeSession?.contextUsage && (
        <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
          <Gauge className="h-3 w-3" />
          No active Claude Code session right now.
        </div>
      )}

      {/* Section divider + link to full Billing page */}
      <button
        type="button"
        onClick={() => onNavigate("/stats")}
        className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground uppercase tracking-wider py-1 border-t border-border/40 pt-3"
      >
        <span>Plan usage</span>
        <ArrowRight className="h-3 w-3" />
      </button>

      {/* --- API mode: monthly spend --- */}
      {isApi ? (
        <UsageRow
          label={
            <span className="flex items-center gap-1.5">
              <Wallet className="h-3 w-3 text-amber-400" />
              Monthly spend
            </span>
          }
          value={
            budget && budget > 0
              ? <>${monthlySpend.toFixed(2)}<span className="text-muted-foreground/60"> / ${budget.toFixed(0)} ({(budgetPct ?? 0).toFixed(0)}%)</span></>
              : <>${monthlySpend.toFixed(2)}</>
          }
          percent={budgetPct}
          sub={
            budget && budget > 0
              ? <>soft budget · calendar month</>
              : <>pay-as-you-go · no plan cap</>
          }
        />
      ) : (
        <>
          {/* --- 5-hour session window --- */}
          {(planUsage?.currentSession || ceilingValue) && (
            <UsageRow
              label={<>5-hour limit</>}
              value={
                sessionPct !== null
                  ? <>{sessionPct.toFixed(0)}%{ceilingIsEstimate && <span className="text-amber-400/80"> est.</span>}</>
                  : <>—</>
              }
              percent={sessionPct}
              sub={
                planUsage?.currentSession ? (
                  <>resets in {fmtDelta(planUsage.currentSession.resetAtIso)}{ceilingValue && <span className="text-muted-foreground/50"> · {fmtTokens(sessionTokens)} / {fmtTokens(ceilingValue)}</span>}</>
                ) : (
                  <>no active window</>
                )
              }
            />
          )}

          {/* --- Weekly Sonnet (if plan has the range) --- */}
          {weeklySonnetPct !== null && planUsage?.weekly && plan && (
            <UsageRow
              label={<>Weekly · Sonnet</>}
              value={<>{weeklySonnetPct.toFixed(0)}%</>}
              percent={weeklySonnetPct}
              sub={
                <>
                  {planUsage.weekly.sonnetHours.toFixed(1)}h / {plan.weekly.sonnetHoursMin}h low-end · rolling 7d
                </>
              }
            />
          )}

          {/* --- Weekly Opus (Max plans only) --- */}
          {weeklyOpusPct !== null && planUsage?.weekly && plan && (
            <UsageRow
              label={<>Weekly · Opus</>}
              value={<>{weeklyOpusPct.toFixed(0)}%</>}
              percent={weeklyOpusPct}
              sub={
                <>
                  {planUsage.weekly.opusHours.toFixed(1)}h / {plan.weekly.opusHoursMin}h low-end · rolling 7d
                </>
              }
            />
          )}

          {/* --- No plan selected yet --- */}
          {!plan && (
            <button
              type="button"
              onClick={() => onNavigate("/stats")}
              className="w-full text-left text-[11px] text-muted-foreground/70 hover:text-foreground border border-dashed border-border rounded-md px-3 py-2"
            >
              No plan selected. Click to pick one on the Billing tab so this card can show real usage percentages.
            </button>
          )}
        </>
      )}

      {/* Personal-ceiling disclosure */}
      {!isApi && ceilingValue && (
        <div className="text-[10px] text-muted-foreground/50 flex items-center justify-between border-t border-border/40 pt-2">
          <span>
            {ceilingIsEstimate ? (
              <>Estimate · no past hits yet</>
            ) : (
              <>Personal ceiling from {sampleSize} past hit{sampleSize === 1 ? "" : "s"}</>
            )}
          </span>
          <button
            type="button"
            onClick={() => onNavigate("/stats")}
            className="hover:text-foreground"
          >
            Details →
          </button>
        </div>
      )}
    </div>
  );
}
