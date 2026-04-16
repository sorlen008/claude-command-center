import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlanLite {
  weekly: { sonnetHoursMin: number | null; sonnetHoursMax: number | null; opusHoursMin: number | null; opusHoursMax: number | null };
  payPerToken: boolean;
}

interface PlanUsageLite {
  selectedPlanId: string | null;
  plan: PlanLite | null;
  currentSession: { resetAtIso: string; tokensUsed: number } | null;
  weekly: { sonnetHours: number; opusHours: number } | null;
  predictedLimitHit: { hitAtIso: string; confidence: string } | null;
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

export function PlanStatusIndicator({ collapsed }: { collapsed: boolean }) {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery<PlanUsageLite>({
    queryKey: ["/api/analytics/plan-usage"],
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // No plan selected — subtle prompt.
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

  // Compute the color and the headline based on whichever signal is most urgent:
  // 1) Predicted limit hit coming soon
  // 2) Weekly Opus near low-end
  // 3) Weekly Sonnet near low-end
  // 4) Current session reset countdown
  let color = "text-emerald-400";
  let dotColor = "bg-emerald-400";
  let headline = "OK";
  let sub = data.currentSession ? `resets ${fmtDelta(data.currentSession.resetAtIso)}` : "idle";

  const opusMin = data.plan?.weekly.opusHoursMin ?? null;
  const sonnetMin = data.plan?.weekly.sonnetHoursMin ?? null;
  const opusUsed = data.weekly?.opusHours ?? 0;
  const sonnetUsed = data.weekly?.sonnetHours ?? 0;
  const opusPct = opusMin ? (opusUsed / opusMin) * 100 : 0;
  const sonnetPct = sonnetMin ? (sonnetUsed / sonnetMin) * 100 : 0;
  const worstPct = Math.max(opusPct, sonnetPct);

  if (worstPct >= 100) {
    color = "text-red-400"; dotColor = "bg-red-500";
    headline = "OVER";
    sub = opusPct >= sonnetPct ? `Opus ${opusUsed.toFixed(1)}/${opusMin}h` : `Sonnet ${sonnetUsed.toFixed(1)}/${sonnetMin}h`;
  } else if (worstPct >= 80) {
    color = "text-amber-400"; dotColor = "bg-amber-500";
    headline = `${Math.round(worstPct)}%`;
    sub = opusPct >= sonnetPct ? `Opus ${opusUsed.toFixed(1)}h` : `Sonnet ${sonnetUsed.toFixed(1)}h`;
  } else if (data.predictedLimitHit) {
    const delta = fmtDelta(data.predictedLimitHit.hitAtIso);
    if (data.predictedLimitHit.confidence !== "low" && Date.parse(data.predictedLimitHit.hitAtIso) - Date.now() < 24 * 60 * 60 * 1000) {
      color = "text-amber-400"; dotColor = "bg-amber-500";
      headline = "SOON";
      sub = `limit in ${delta}`;
    } else {
      headline = `${Math.round(worstPct)}%`;
    }
  } else if (worstPct > 0) {
    headline = `${Math.round(worstPct)}%`;
  }

  return (
    <button
      onClick={() => setLocation("/stats")}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-sidebar-accent/30 transition-colors w-full",
        collapsed ? "justify-center" : ""
      )}
      title={
        `${data.plan ? `Plan usage · ${headline}` : "No plan"} — click for details`
      }
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
