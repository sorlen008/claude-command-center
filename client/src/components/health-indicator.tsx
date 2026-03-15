import { cn } from "@/lib/utils";

const healthColors: Record<string, string> = {
  ok: "bg-green-500",
  warning: "bg-yellow-500",
  error: "bg-red-500",
  unknown: "bg-gray-500",
};

export function HealthIndicator({ health, className }: { health: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", healthColors[health] || healthColors.unknown, className)}
      title={health}
    />
  );
}
