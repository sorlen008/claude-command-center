import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/skeleton";
import { Search, Star, ExternalLink, TrendingUp, Sparkles } from "lucide-react";

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
  TypeScript: "bg-blue-500",
  JavaScript: "bg-yellow-500",
  Python: "bg-green-500",
  Go: "bg-cyan-500",
  Rust: "bg-orange-500",
  Java: "bg-red-500",
};

function starBadgeColor(stars: number): string {
  if (stars >= 1000) return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
  if (stars >= 100) return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export default function Discovery() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: results, isLoading } = useQuery<DiscoveryResult[]>({
    queryKey: [`/api/discovery/search?q=${encodeURIComponent(searchTerm)}`],
    enabled: searchTerm.length > 0,
  });

  const handleSearch = (q?: string) => {
    const term = q || query.trim();
    if (term) {
      setQuery(term);
      setSearchTerm(term);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Discovery</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Search GitHub for MCP servers, plugins, and tools</p>
      </div>

      <div className="flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search GitHub (e.g. 'mcp server finance')..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-9"
          />
        </div>
        <Button onClick={() => handleSearch()} disabled={isLoading || !query.trim()}>
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </div>

      {/* Suggested searches when no results */}
      {!results && !isLoading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            Suggested searches
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {suggestedSearches.map((s, i) => (
              <button
                key={s.query}
                onClick={() => handleSearch(s.query)}
                className="flex items-center gap-2 rounded-lg border border-border/50 px-4 py-3 text-sm hover:bg-accent/50 hover:scale-[1.02] transition-all text-left card-hover animate-fade-in-up"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <Badge variant="outline" className={`text-[10px] px-1.5 ${categoryColors[s.icon] || categoryColors.other}`}>
                  {s.icon}
                </Badge>
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
            {results.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" /> Sorted by stars
              </div>
            )}
          </div>
          {results.map((repo, i) => (
            <Card
              key={repo.id}
              className="card-hover animate-fade-in-up"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-sm hover:underline"
                      >
                        {repo.name}
                      </a>
                      <Badge variant="outline" className={`text-[10px] ${categoryColors[repo.category] || categoryColors.other}`}>
                        {repo.category}
                      </Badge>
                      {repo.language && (
                        <div className="flex items-center gap-1">
                          <span className={`w-2 h-2 rounded-full ${languageColors[repo.language] || "bg-gray-500"}`} />
                          <Badge variant="secondary" className="text-[10px]">{repo.language}</Badge>
                        </div>
                      )}
                    </div>
                    {repo.description && (
                      <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{repo.description}</p>
                    )}
                    {repo.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {repo.topics.slice(0, 6).map((topic) => (
                          <Badge key={topic} variant="secondary" className="text-[10px] px-1.5">{topic}</Badge>
                        ))}
                        {repo.topics.length > 6 && (
                          <span className="text-[10px] text-muted-foreground">+{repo.topics.length - 6}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                    <Badge variant="outline" className={`text-xs gap-1 ${starBadgeColor(repo.stars)}`}>
                      <Star className="h-3 w-3" />
                      <span className="font-mono">{repo.stars.toLocaleString()}</span>
                    </Badge>
                    <a href={repo.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Open in GitHub">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
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
