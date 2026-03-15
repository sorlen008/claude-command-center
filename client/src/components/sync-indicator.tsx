import { useLiveSync } from "@/hooks/use-scanner";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";

export function SyncIndicator({ collapsed }: { collapsed: boolean }) {
  const { connected, lastEvent } = useLiveSync();

  const isScanning = lastEvent?.type === "scan-start";

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-[11px]",
        collapsed ? "justify-center" : ""
      )}
      title={
        connected
          ? isScanning
            ? "Scanning for changes..."
            : `Live sync active (v${lastEvent?.version || 0})`
          : "Disconnected — retrying..."
      }
    >
      {isScanning ? (
        <RefreshCw className="h-3 w-3 text-amber-400 animate-spin flex-shrink-0" />
      ) : connected ? (
        <Wifi className="h-3 w-3 text-emerald-400 flex-shrink-0" />
      ) : (
        <WifiOff className="h-3 w-3 text-red-400 flex-shrink-0" />
      )}
      {!collapsed && (
        <span className={cn(
          "font-mono",
          connected ? "text-emerald-400/70" : "text-red-400/70"
        )}>
          {isScanning ? "Scanning..." : connected ? "Live" : "Offline"}
        </span>
      )}
    </div>
  );
}
