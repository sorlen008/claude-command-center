import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="relative flex flex-col items-center justify-center py-16 px-4 overflow-hidden">
      {/* Animated floating dots background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="empty-state-dot" style={{ width: 80, height: 80, top: "20%", left: "15%", animationDelay: "0s" }} />
        <div className="empty-state-dot" style={{ width: 60, height: 60, top: "60%", right: "20%", animationDelay: "1s" }} />
        <div className="empty-state-dot" style={{ width: 40, height: 40, top: "30%", right: "30%", animationDelay: "2s" }} />
      </div>

      <div className="relative flex flex-col items-center">
        <div className="rounded-2xl bg-muted/30 p-4 mb-4 empty-state-icon">
          <Icon className="h-10 w-10 text-muted-foreground/40" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground/50 mt-1 text-center max-w-[280px]">{description}</p>
        )}
        {action && (
          <Button variant="outline" size="sm" className="mt-4" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
