import { Card, CardContent } from "@/components/ui/card";
import type { EntityType } from "@shared/types";
import { entityConfig } from "@/components/entity-badge";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

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

  return (
    <Card
      className={cn(
        "cursor-pointer card-hover group overflow-hidden relative",
      )}
      onClick={onClick}
    >
      <div className={cn("absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity", config.bg)} />
      <CardContent className="p-4 relative">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{config.label}s</p>
            <p className="text-3xl font-bold mt-1 tabular-nums">{count}</p>
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
          <div className={cn("rounded-xl p-3 transition-transform group-hover:scale-110", config.bg)}>
            <Icon className={cn("h-5 w-5", config.color)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
