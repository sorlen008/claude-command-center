import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUpdateStatus, useCheckForUpdate, useApplyUpdate } from "@/hooks/use-update";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowUpCircle,
  Check,
  Loader2,
  AlertCircle,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

export function UpdateIndicator({ collapsed }: { collapsed: boolean }) {
  const { data: status } = useUpdateStatus();
  const checkMutation = useCheckForUpdate();
  const applyMutation = useApplyUpdate();
  const [open, setOpen] = useState(false);

  const isChecking = checkMutation.isPending;
  const isApplying = applyMutation.isPending;
  const applyResult = applyMutation.data;
  const hasUpdate = status?.updateAvailable && status.commitsBehind > 0;
  const hasError = checkMutation.isError || applyMutation.isError || !!status?.error;
  const isDone = applyResult?.success && applyResult.restartRequired;

  // Determine what icon/dot to show
  const showDot = hasUpdate || isApplying || isDone || hasError;

  if (!showDot && !open) return null;

  const dotColor = isDone
    ? "bg-emerald-400"
    : isApplying
    ? "bg-blue-400 animate-pulse"
    : hasError
    ? "bg-red-400"
    : "bg-amber-400 animate-pulse";

  const trigger = collapsed ? (
    // Collapsed: small absolute dot on the brand icon area
    <PopoverTrigger asChild>
      <button
        className="absolute -top-0.5 -right-0.5 z-10"
        aria-label="Update available"
      >
        <span className={cn("block w-2 h-2 rounded-full", dotColor)} />
      </button>
    </PopoverTrigger>
  ) : (
    // Expanded: icon button next to title
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded-md hover:bg-sidebar-accent/50 transition-colors"
            aria-label="Update available"
          >
            {isDone ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : isApplying ? (
              <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
            ) : hasError ? (
              <AlertCircle className="h-3.5 w-3.5 text-red-400" />
            ) : (
              <ArrowUpCircle className="h-3.5 w-3.5 text-amber-400" />
            )}
          </button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isDone
          ? "Restart required"
          : isApplying
          ? "Updating..."
          : hasError
          ? "Update error"
          : `${status?.commitsBehind} update${status?.commitsBehind !== 1 ? "s" : ""} available`}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        className="w-72 p-0"
      >
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Updates
            </span>
            {status?.currentVersion && (
              <span className="text-[10px] font-mono text-muted-foreground">
                v{status.currentVersion}
              </span>
            )}
          </div>

          {/* No git remote */}
          {status && !status.hasGitRemote && (
            <div className="text-xs text-muted-foreground">
              No git remote configured. Add one with{" "}
              <code className="text-[10px] bg-muted px-1 rounded">git remote add origin &lt;url&gt;</code>
            </div>
          )}

          {/* Never checked */}
          {status?.hasGitRemote !== false && !status?.lastCheckedAt && !isChecking && (
            <div className="text-xs text-muted-foreground">Not checked yet.</div>
          )}

          {/* Up to date */}
          {status?.lastCheckedAt && !hasUpdate && !isDone && !hasError && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              Up to date
              <span className="text-muted-foreground ml-auto font-mono">
                {status.currentCommit}
              </span>
            </div>
          )}

          {/* Update available */}
          {hasUpdate && !isDone && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <ArrowUpCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span>
                  <strong>{status.commitsBehind}</strong> commit
                  {status.commitsBehind !== 1 ? "s" : ""} behind
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                <span>{status.currentCommit}</span>
                <span>→</span>
                <span>{status.latestCommit}</span>
              </div>
            </div>
          )}

          {/* Apply result — step progress */}
          {applyResult && (
            <div className="space-y-1.5">
              {applyResult.steps.map((step) => (
                <div
                  key={step.name}
                  className="flex items-center gap-2 text-xs"
                >
                  {step.status === "success" ? (
                    <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                  ) : step.status === "failed" ? (
                    <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
                  ) : (
                    <div className="h-3 w-3 rounded-full border border-muted-foreground/30 shrink-0" />
                  )}
                  <span
                    className={cn(
                      step.status === "failed" && "text-red-400",
                      step.status === "skipped" && "text-muted-foreground"
                    )}
                  >
                    {step.name}
                  </span>
                </div>
              ))}
              {applyResult.steps.some((s) => s.status === "failed") && (
                <div className="text-[10px] text-red-400 mt-1 font-mono leading-tight max-h-16 overflow-auto">
                  {applyResult.steps.find((s) => s.status === "failed")?.output}
                </div>
              )}
            </div>
          )}

          {/* Done — restart required */}
          {isDone && (
            <div className="text-xs text-emerald-400 flex items-center gap-2">
              <RotateCcw className="h-3.5 w-3.5" />
              Restart the server to apply changes
            </div>
          )}

          {/* Error */}
          {status?.error && !applyResult && (
            <div className="text-[10px] text-red-400 font-mono leading-tight">
              {status.error}
            </div>
          )}

          {/* Last checked */}
          {status?.lastCheckedAt && (
            <div className="text-[10px] text-muted-foreground">
              Checked {formatTimeAgo(status.lastCheckedAt)}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {!isDone && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                disabled={isChecking || isApplying}
                onClick={() => checkMutation.mutate()}
              >
                {isChecking ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Check
              </Button>
            )}
            {hasUpdate && !isDone && (
              <Button
                size="sm"
                className="h-7 text-xs flex-1"
                disabled={isApplying}
                onClick={() => applyMutation.mutate()}
              >
                {isApplying ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <ArrowUpCircle className="h-3 w-3 mr-1" />
                )}
                Update Now
              </Button>
            )}
            {(isDone || applyResult?.error) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={() => {
                  applyMutation.reset();
                  checkMutation.mutate();
                }}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Check Again
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
