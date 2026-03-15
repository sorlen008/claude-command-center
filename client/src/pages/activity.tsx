import { useQuery } from "@tanstack/react-query";
import { useScanStatus } from "@/hooks/use-entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRescan } from "@/hooks/use-entities";
import { RefreshCw, Activity, FileText, FolderPlus, Trash2, Edit3, Clock } from "lucide-react";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function getTimePeriod(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);
  if (diffHrs < 24 && date.getDate() === now.getDate()) return "Today";
  if (diffHrs < 48) return "Yesterday";
  return "Earlier";
}

const eventIcons: Record<string, React.ElementType> = {
  add: FolderPlus,
  change: Edit3,
  unlink: Trash2,
  addDir: FolderPlus,
};

const eventColors: Record<string, string> = {
  add: "text-green-400",
  change: "text-amber-400",
  unlink: "text-red-400",
  addDir: "text-blue-400",
};

const eventBorderColors: Record<string, string> = {
  add: "border-green-500",
  change: "border-amber-500",
  unlink: "border-red-500",
  addDir: "border-blue-500",
};

export default function ActivityPage() {
  const { data: changes, isLoading } = useQuery<string[]>({
    queryKey: ["/api/watcher/changes"],
    refetchInterval: 5000,
  });
  const { data: status } = useScanStatus();
  const rescan = useRescan();

  const parsed = (changes || []).map((entry) => {
    const match = entry.match(/^(.+?) \[(.+?)\] (.+)$/);
    if (!match) return { timestamp: "", event: "unknown", path: entry };
    return { timestamp: match[1], event: match[2], path: match[3] };
  }).reverse();

  // Group by time period
  const grouped = parsed.reduce((acc, entry) => {
    const period = entry.timestamp ? getTimePeriod(entry.timestamp) : "Earlier";
    if (!acc[period]) acc[period] = [];
    acc[period].push(entry);
    return acc;
  }, {} as Record<string, typeof parsed>);

  const statusData = status as any;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activity</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time filesystem changes detected by the watcher
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${rescan.isPending ? "animate-spin" : ""}`} />
          Force Rescan
        </Button>
      </div>

      {/* Scanner stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { value: statusData?.scanVersion || 0, label: "Scan Version" },
          { value: statusData?.totalEntities || 0, label: "Total Entities" },
          { value: statusData?.totalRelationships || 0, label: "Relationships" },
          { value: `${statusData?.lastScanDuration || 0}ms`, label: "Last Scan Duration" },
        ].map((stat, i) => (
          <Card key={stat.label} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Change log */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              Change Log
            </CardTitle>
            <Badge variant="secondary" className="text-xs">{parsed.length} events</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : parsed.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No filesystem changes detected yet</p>
              <p className="text-xs mt-1">Changes to skills, memory, MCPs, and configs will appear here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([period, entries]) => (
                <div key={period}>
                  <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2">
                    {period}
                  </div>
                  <div className="relative pl-4">
                    {/* Vertical timeline line */}
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/50" />
                    <div className="space-y-0.5">
                      {entries.map((entry, i) => {
                        const Icon = eventIcons[entry.event] || FileText;
                        const color = eventColors[entry.event] || "text-muted-foreground";
                        const borderColor = eventBorderColors[entry.event] || "border-muted";
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-3 py-2 relative animate-fade-in-up`}
                            style={{ animationDelay: `${i * 15}ms` }}
                          >
                            {/* Timeline dot */}
                            <div className={`absolute -left-4 w-2 h-2 rounded-full border-2 ${borderColor} bg-card z-10`} />
                            <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${color}`} />
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${color} border-current/30`}>
                              {entry.event}
                            </Badge>
                            <span className="text-sm font-mono truncate flex-1">{entry.path}</span>
                            {entry.timestamp && (
                              <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {relativeTime(entry.timestamp)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
