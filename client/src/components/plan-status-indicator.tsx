import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

interface HistoricalLimitsLite {
  medianTokens: number | null;
  sampleSize: number;
  totalHitsLast30Days: number;
}

interface PlanUsageLite {
  selectedPlanId: string | null;
  plan: { payPerToken: boolean } | null;
  currentSession: { resetAtIso: string; tokensUsed: number } | null;
  historicalLimits: HistoricalLimitsLite;
}

function fmtDelta(iso: string): string {
  const diffMs = Date.parse(iso) - Date.now();
  if (diffMs <= 0) return "now";
  const h = Math.floor(diffMs / (60 * 60 * 1000));
  const m = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Sidebar pill with three-tier honesty:
 *
 * 1. If the user has past rate-limit hits parsed from JSONL, the bar uses the
 *    median of those personal hits as the ceiling. This is grounded in what
 *    actually happened to them.
 * 2. If no hit history exists, show the raw 5-hour-session reset countdown.
 *    Don't invent a percentage against Anthropic's published ranges because
 *    those are too wide to flag OVER reliably (see v2.1.0 false-alarm feedback).
 * 3. No plan selected — show a quiet "No plan set" link.
 */
export function PlanStatusIndicator({ collapsed }: { collapsed: boolean }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<PlanUsageLite>({
    queryKey: ["/api/analytics/plan-usage"],
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (!isLoading && (!data || !data.selectedPlanId)) {
    return (
      <button
        onClick={() => setLocation("/stats")}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-sidebar-accent/30 transition-colors w-full",
          collapsed ? "justify-center" : ""
        )}
        title="Select your Claude plan"
      >
        <Gauge className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
        {!collapsed && <span className="font-mono text-muted-foreground/60">No plan set</span>}
      </button>
    );
  }

  if (!data) {
    return (
      <div className={cn("flex items-center gap-2 px-3 py-1.5 text-[11px]", collapsed ? "justify-center" : "")}>
        <Gauge className="h-3 w-3 text-muted-foreground/40 flex-shrink-0 animate-pulse" />
        {!collapsed && <span className="font-mono text-muted-foreground/40">…</span>}
      </div>
    );
  }

  const tokens = data.currentSession?.tokensUsed ?? 0;
  const medianCeiling = data.historicalLimits.medianTokens;
  const hasPersonalCeiling = medianCeiling !== null && medianCeiling > 0 && data.historicalLimits.sampleSize >= 2;

  let headline = "OK";
  let sub = data.currentSession ? `reset ${fmtDelta(data.currentSession.resetAtIso)}` : "idle";
  let color = "text-emerald-400";
  let dotColor = "bg-emerald-400";

  if (hasPersonalCeiling && data.currentSession) {
    const pct = (tokens / medianCeiling!) * 100;
    if (pct >= 100) {
      headline = "OVER";
      color = "text-red-400"; dotColor = "bg-red-500";
      sub = `${fmtDelta(data.currentSession.resetAtIso)} until reset`;
    } else if (pct >= 85) {
      headline = `${Math.round(pct)}%`;
      color = "text-red-400"; dotColor = "bg-red-500";
      sub = `of your ceiling`;
    } else if (pct >= 60) {
      headline = `${Math.round(pct)}%`;
      color = "text-amber-400"; dotColor = "bg-amber-500";
      sub = `of your ceiling`;
    } else if (pct >= 30) {
      headline = `${Math.round(pct)}%`;
      color = "text-yellow-300"; dotColor = "bg-yellow-400";
      sub = `of your ceiling`;
    } else {
      headline = `${Math.round(pct)}%`;
      sub = data.currentSession ? `reset ${fmtDelta(data.currentSession.resetAtIso)}` : sub;
    }
  } else if (data.currentSession) {
    // No historical data — show the only honest signal: session reset countdown.
    headline = fmtDelta(data.currentSession.resetAtIso);
    sub = "session reset";
    color = "text-muted-foreground";
    dotColor = "bg-muted-foreground/60";
  }

  const tooltip = hasPersonalCeiling
    ? `${Math.round((tokens / medianCeiling!) * 100)}% of your personal ceiling (${medianCeiling!.toLocaleString()} tokens, from ${data.historicalLimits.sampleSize} past hits). Click for details.`
    : data.historicalLimits.sampleSize === 0
      ? "No past limit hits detected — can't personalize ceiling yet. Click for Billing details."
      : "Click for plan details";

  return (
    <button
      onClick={() => setLocation("/stats")}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-sidebar-accent/30 transition-colors w-full",
        collapsed ? "justify-center" : ""
      )}
      title={tooltip}
    >
      <span className="relative flex items-center flex-shrink-0">
        <Gauge className={cn("h-3 w-3", color)} />
        <span className={cn("absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full", dotColor)} />
      </span>
      {!collapsed && (
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={cn("font-mono font-semibold", color)}>{headline}</span>
          <span className="text-muted-foreground/60 truncate">{sub}</span>
        </div>
      )}
    </button>
  );
}
