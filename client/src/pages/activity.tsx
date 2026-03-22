import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScanStatus, useRescan } from "@/hooks/use-entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/skeleton";
import {
  RefreshCw, Activity, FileText, FolderPlus, Trash2, Edit3, Clock,
  Search, Star, ExternalLink, TrendingUp, Sparkles,
} from "lucide-react";
import { relativeTime } from "@/lib/utils";

// ── Activity Tab ────────────────────────────────────────────────────────────

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
  add: FolderPlus, change: Edit3, unlink: Trash2, addDir: FolderPlus,
};
const eventColors: Record<string, string> = {
  add: "text-green-400", change: "text-amber-400", unlink: "text-red-400", addDir: "text-blue-400",
};
const eventBorderColors: Record<string, string> = {
  add: "border-green-500", change: "border-amber-500", unlink: "border-red-500", addDir: "border-blue-500",
};

function ActivityTab() {
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

  const grouped = parsed.reduce((acc, entry) => {
    const period = entry.timestamp ? getTimePeriod(entry.timestamp) : "Earlier";
    if (!acc[period]) acc[period] = [];
    acc[period].push(entry);
    return acc;
  }, {} as Record<string, typeof parsed>);

  const statusData = status as any;

  return (
    <div className="space-y-6">
      {/* Scanner stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { value: statusData?.scanVersion || 0, label: "Scan Version" },
          { value: statusData?.totalEntities || 0, label: "Total Entities" },
          { value: statusData?.totalRelationships || 0, label: "Relationships" },
          { value: `${statusData?.lastScanDuration || 0}ms`, label: "Last Scan" },
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
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">{parsed.length} events</Badge>
              <Button variant="outline" size="sm" onClick={() => rescan.mutate()} disabled={rescan.isPending} className="gap-1.5 h-7 text-xs">
                <RefreshCw className={`h-3 w-3 ${rescan.isPending ? "animate-spin" : ""}`} />
                Rescan
              </Button>
            </div>
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
                  <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest mb-2">{period}</div>
                  <div className="relative pl-4">
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border/50" />
                    <div className="space-y-0.5">
                      {entries.map((entry, i) => {
                        const Icon = eventIcons[entry.event] || FileText;
                        const color = eventColors[entry.event] || "text-muted-foreground";
                        const borderColor = eventBorderColors[entry.event] || "border-muted";
                        return (
                          <div key={i} className="flex items-center gap-3 py-2 relative animate-fade-in-up" style={{ animationDelay: `${i * 15}ms` }}>
                            <div className={`absolute -left-4 w-2 h-2 rounded-full border-2 ${borderColor} bg-card z-10`} />
                            <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${color}`} />
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${color} border-current/30`}>{entry.event}</Badge>
                            <span className="text-sm font-mono truncate flex-1">{entry.path}</span>
                            {entry.timestamp && (
                              <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0 flex items-center gap-1">
                                <Clock className="h-3 w-3" />{relativeTime(entry.timestamp)}
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

// ── Discover Tab ────────────────────────────────────────────────────────────

interface DiscoveryResult {
  id: number;
  name: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  topics: string[];
  category: string;
  updatedAt: string;
}

const suggestedSearches = [
  { label: "MCP Servers", query: "mcp server model context protocol", icon: "mcp" },
  { label: "Claude Tools", query: "claude code tools", icon: "skill" },
  { label: "AI Plugins", query: "ai assistant plugin typescript", icon: "plugin" },
  { label: "Finance APIs", query: "mcp finance api", icon: "mcp" },
  { label: "Database MCP", query: "mcp database postgresql sqlite", icon: "mcp" },
  { label: "Browser Automation", query: "mcp browser playwright puppeteer", icon: "mcp" },
];

const categoryColors: Record<string, string> = {
  mcp: "border-green-500/30 text-green-400 bg-green-500/5",
  plugin: "border-purple-500/30 text-purple-400 bg-purple-500/5",
  skill: "border-orange-500/30 text-orange-400 bg-orange-500/5",
  other: "border-slate-500/30 text-slate-400 bg-slate-500/5",
};

const languageColors: Record<string, string> = {
  TypeScript: "bg-blue-500", JavaScript: "bg-yellow-500", Python: "bg-green-500",
  Go: "bg-cyan-500", Rust: "bg-orange-500", Java: "bg-red-500",
};

function starBadgeColor(stars: number): string {
  if (stars >= 1000) return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
  if (stars >= 100) return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function DiscoverTab() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: results, isLoading } = useQuery<DiscoveryResult[]>({
    queryKey: [`/api/discovery/search?q=${encodeURIComponent(searchTerm)}`],
    enabled: searchTerm.length > 0,
  });

  const handleSearch = (q?: string) => {
    const term = q || query.trim();
    if (term) { setQuery(term); setSearchTerm(term); }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search GitHub (e.g. 'mcp server finance')..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} className="pl-9" />
        </div>
        <Button onClick={() => handleSearch()} disabled={isLoading || !query.trim()}>{isLoading ? "Searching..." : "Search"}</Button>
      </div>

      {!results && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Sparkles className="h-4 w-4" />Suggested searches</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {suggestedSearches.map((s, i) => (
              <button key={s.query} onClick={() => handleSearch(s.query)} className="flex items-center gap-2 rounded-lg border border-border/50 px-4 py-3 text-sm hover:bg-accent/50 hover:scale-[1.02] transition-all text-left card-hover animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                <Badge variant="outline" className={`text-[10px] px-1.5 ${categoryColors[s.icon] || categoryColors.other}`}>{s.icon}</Badge>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && <ListSkeleton rows={5} />}

      {results && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{results.length} results for "{searchTerm}"</p>
            {results.length > 0 && <div className="flex items-center gap-1 text-xs text-muted-foreground"><TrendingUp className="h-3 w-3" /> Sorted by stars</div>}
          </div>
          {results.map((repo, i) => (
            <Card key={repo.id} className="card-hover animate-fade-in-up" style={{ animationDelay: `${i * 30}ms` }}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <a href={repo.url} target="_blank" rel="noopener noreferrer" className="font-medium text-sm hover:underline">{repo.name}</a>
                      <Badge variant="outline" className={`text-[10px] ${categoryColors[repo.category] || categoryColors.other}`}>{repo.category}</Badge>
                      {repo.language && (
                        <div className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-full ${languageColors[repo.language] || "bg-gray-500"}`} />
                          <Badge variant="secondary" className="text-[10px]">{repo.language}</Badge>
                        </div>
                      )}
                    </div>
                    {repo.description && <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{repo.description}</p>}
                    {repo.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {repo.topics.slice(0, 6).map((topic) => (<Badge key={topic} variant="secondary" className="text-[10px] px-1.5">{topic}</Badge>))}
                        {repo.topics.length > 6 && <span className="text-[10px] text-muted-foreground">+{repo.topics.length - 6}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                    <Badge variant="outline" className={`text-xs gap-1 ${starBadgeColor(repo.stars)}`}>
                      <Star className="h-3 w-3" /><span className="font-mono">{repo.stars.toLocaleString()}</span>
                    </Badge>
                    <a href={repo.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {results.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No results found for "{searchTerm}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const [tab, setTab] = useState<"activity" | "discover">("activity");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Activity & Discover</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {tab === "activity" ? "Real-time filesystem changes detected by the watcher" : "Search GitHub for MCP servers, plugins, and tools"}
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {([["activity", "Activity"], ["discover", "Discover"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === key ? "border-blue-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "activity" && <ActivityTab />}
      {tab === "discover" && <DiscoverTab />}
    </div>
  );
}
