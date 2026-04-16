import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Gauge, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

interface HistoricalLimitsLite {
  medianTokens: number | null;
  p90Tokens: number | null;
  sampleSize: number;
  totalHitsLast30Days: number;
}

interface SettingsLite { monthlyBudget?: number | null }

interface PlanUsageLite {
  selectedPlanId: string | null;
  plan: { payPerToken: boolean } | null;
  billingModeDetected: "subscription" | "api" | "unknown";
  apiKeyPresent: boolean;
  currentSession: { resetAtIso: string; tokensUsed: number } | null;
  monthly: { costUsd: number; tokensUsed: number } | null;
  historicalLimits: HistoricalLimitsLite;
  estimatedCeiling: { tokensPerSession: number | null; confidence: "estimate" | "unknown" };
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
 * Sidebar pill. Adapts to the user's billing mode:
 *
 * — API / pay-as-you-go: show monthly $ spent (with optional budget %).
 * — Subscription + ≥2 past hits: personal-median percentage.
 * — Subscription + plan selected but no hits: fallback estimate percentage
 *   (tagged `est.` in tooltip so the user knows it isn't personalized yet).
 * — Subscription + active session but no ceiling basis: plain reset countdown.
 * — No plan: quiet "No plan set" link.
 */
export function PlanStatusIndicator({ collapsed }: { collapsed: boolean }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<PlanUsageLite>({
    queryKey: ["/api/analytics/plan-usage"],
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const { data: settings } = useQuery<SettingsLite>({
    queryKey: ["/api/settings"],
    staleTime: 120_000,
  });

  const isApi = data?.billingModeDetected === "api";

  if (!isLoading && (!data || (!data.selectedPlanId && !isApi))) {
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

  // API mode — show monthly $ spent. If a budget is set, color against it.
  if (isApi) {
    const spent = data.monthly?.costUsd ?? 0;
    const budget = settings?.monthlyBudget ?? null;
    const pct = budget && budget > 0 ? (spent / budget) * 100 : null;
    let color = "text-amber-300";
    let dotColor = "bg-amber-400";
    if (pct !== null) {
      if (pct >= 100) { color = "text-red-400"; dotColor = "bg-red-500"; }
      else if (pct >= 80) { color = "text-red-400"; dotColor = "bg-red-500"; }
      else if (pct >= 50) { color = "text-amber-400"; dotColor = "bg-amber-500"; }
      else { color = "text-emerald-400"; dotColor = "bg-emerald-400"; }
    }
    const headline = `$${spent.toFixed(2)}`;
    const sub = budget && budget > 0 ? `of $${budget.toFixed(0)} budget` : "this month";
    const tooltip = `Pay-as-you-go — $${spent.toFixed(2)} this calendar month${budget && budget > 0 ? ` of $${budget.toFixed(0)} budget (${Math.round(pct!)}%)` : ""}. Click for details.`;
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
          <Wallet className={cn("h-3 w-3", color)} />
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

  // Subscription mode — ceiling logic.
  const tokens = data.currentSession?.tokensUsed ?? 0;
  const medianCeiling = data.historicalLimits.medianTokens;
  const hasPersonalCeiling = medianCeiling !== null && medianCeiling > 0 && data.historicalLimits.sampleSize >= 2;
  const estimatedCeiling = data.estimatedCeiling.tokensPerSession;
  const hasEstimateCeiling = !hasPersonalCeiling && estimatedCeiling !== null && estimatedCeiling > 0;
  const ceilingValue: number | null = hasPersonalCeiling ? medianCeiling : hasEstimateCeiling ? estimatedCeiling : null;

  let headline = "OK";
  let sub = data.currentSession ? `reset ${fmtDelta(data.currentSession.resetAtIso)}` : "idle";
  let color = "text-emerald-400";
  let dotColor = "bg-emerald-400";

  if (ceilingValue !== null && data.currentSession) {
    const pct = (tokens / ceilingValue) * 100;
    const suffix = hasPersonalCeiling ? " of your ceiling" : " est.";
    if (pct >= 100) {
      headline = hasPersonalCeiling ? "OVER" : `${Math.round(pct)}%`;
      color = "text-red-400"; dotColor = "bg-red-500";
      sub = `${fmtDelta(data.currentSession.resetAtIso)} until reset`;
    } else if (pct >= 85) {
      headline = `${Math.round(pct)}%`;
      color = "text-red-400"; dotColor = "bg-red-500";
      sub = `${suffix.trim()}`;
    } else if (pct >= 60) {
      headline = `${Math.round(pct)}%`;
      color = "text-amber-400"; dotColor = "bg-amber-500";
      sub = `${suffix.trim()}`;
    } else if (pct >= 30) {
      headline = `${Math.round(pct)}%`;
      color = "text-yellow-300"; dotColor = "bg-yellow-400";
      sub = `${suffix.trim()}`;
    } else {
      headline = `${Math.round(pct)}%`;
      sub = data.currentSession ? `reset ${fmtDelta(data.currentSession.resetAtIso)}` : sub;
    }
  } else if (data.currentSession) {
    headline = fmtDelta(data.currentSession.resetAtIso);
    sub = "session reset";
    color = "text-muted-foreground";
    dotColor = "bg-muted-foreground/60";
  }

  const tooltip = hasPersonalCeiling
    ? `${Math.round((tokens / ceilingValue!) * 100)}% of your personal ceiling (${ceilingValue!.toLocaleString()} tokens, from ${data.historicalLimits.sampleSize} past hits). Click for details.`
    : hasEstimateCeiling
      ? `Estimated ceiling (${ceilingValue!.toLocaleString()} tokens) — no past limit hits yet, so this is plan-based. Click for Billing.`
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
