import { Card, CardContent } from "@/components/ui/card";
import type { EntityType } from "@shared/types";
import { entityConfig } from "@/components/entity-badge";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useCountUp } from "@/hooks/use-count-up";

const entityHex: Record<EntityType, string> = {
  project: "#3b82f6",
  mcp: "#22c55e",
  plugin: "#a855f7",
  skill: "#f97316",
  markdown: "#64748b",
  config: "#14b8a6",
};

interface StatCardProps {
  type: EntityType;
  count: number;
  subtitle?: string;
  onClick?: () => void;
  trend?: "up" | "down" | "flat";
  trendValue?: string;
}

export function StatCard({ type, count, subtitle, onClick, trend, trendValue }: StatCardProps) {
  const config = entityConfig[type];
  const Icon = config.icon;
  const hex = entityHex[type];
  const animatedCount = useCountUp(count);

  return (
    <Card
      className={cn(
        "cursor-pointer card-hover group overflow-hidden relative gradient-border",
      )}
      onClick={onClick}
    >
      {/* Top-edge gradient line */}
      <div
        className="absolute top-0 left-0 right-0 h-px opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: `linear-gradient(90deg, ${hex}80, transparent)` }}
      />
      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0 opacity-[0.04] group-hover:opacity-[0.08] transition-opacity"
        style={{ background: `radial-gradient(circle at top right, ${hex}30, transparent 70%)` }}
      />
      <CardContent className="p-4 relative">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{config.label}s</p>
            <p className="text-3xl font-bold mt-1 tabular-nums">{Math.round(animatedCount)}</p>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
            {trend && trendValue && (
              <div className={cn(
                "flex items-center gap-1 mt-1 text-[10px] font-medium",
                trend === "up" ? "text-green-400" : trend === "down" ? "text-red-400" : "text-muted-foreground"
              )}>
                {trend === "up" ? <TrendingUp className="h-3 w-3" /> : trend === "down" ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                <span>{trendValue}</span>
              </div>
            )}
          </div>
          <div className={cn("rounded-xl p-3 transition-all group-hover:scale-110 group-hover:shadow-[0_0_16px_currentColor/0.2]", config.bg)}>
            <Icon className={cn("h-5 w-5", config.color)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
