import { useEntities } from "@/hooks/use-entities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HealthIndicator } from "@/components/health-indicator";
import { Puzzle, Store, ShieldAlert, ShieldCheck, Server, GitBranch, Code2 } from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  "dev-tools": "border-violet-500/30 text-violet-400",
  integration: "border-pink-500/30 text-pink-400",
  ai: "border-emerald-500/30 text-emerald-400",
  browser: "border-amber-500/30 text-amber-400",
  productivity: "border-sky-500/30 text-sky-400",
  "code-quality": "border-teal-500/30 text-teal-400",
  lsp: "border-indigo-500/30 text-indigo-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  "dev-tools": "Developer Tools",
  integration: "Integrations",
  ai: "AI & ML",
  browser: "Browser",
  productivity: "Productivity",
  "code-quality": "Code Quality",
  lsp: "Language Servers (LSP)",
};

export default function Plugins() {
  const { data: plugins, isLoading } = useEntities("plugin");

  const marketplaces = (plugins || []).filter((p) => p.tags.includes("marketplace"));
  const blocked = (plugins || []).filter((p) => !p.tags.includes("marketplace") && (p.data as any).blocked);
  const active = (plugins || []).filter((p) => !p.tags.includes("marketplace") && !(p.data as any).blocked);

  // Group active by category
  const grouped = active.reduce<Record<string, typeof active>>((acc, plugin) => {
    const cat = (plugin.data as any).category || "other";
    (acc[cat] = acc[cat] || []).push(plugin);
    return acc;
  }, {});

  // Sort order: lsp last, then alphabetical
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    if (a === "lsp") return 1;
    if (b === "lsp") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Plugins</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Plugins extend Claude Code with skills, commands, hooks, and MCP servers
        </p>
      </div>

      {/* Summary bar */}
      {!isLoading && (active.length > 0 || blocked.length > 0) && (
        <div className="flex items-center gap-2">
          <Badge className="bg-green-500/10 text-green-400 border-green-500/20 gap-1">
            <ShieldCheck className="h-3 w-3" />
            {active.length} active
          </Badge>
          {blocked.length > 0 && (
            <Badge className="bg-red-500/10 text-red-400 border-red-500/20 gap-1">
              <ShieldAlert className="h-3 w-3" />
              {blocked.length} blocked
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            across {marketplaces.length} marketplace{marketplaces.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading plugins...</div>
      ) : (
        <>
          {/* Marketplaces */}
          {marketplaces.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Store className="h-3.5 w-3.5" /> Marketplaces
              </h2>
              {marketplaces.map((mkt, i) => {
                const data = mkt.data as any;
                // Count plugins in this marketplace
                const mktPluginCount = active.filter((p) => (p.data as any).marketplace === mkt.name).length;
                return (
                  <Card
                    key={mkt.id}
                    className="card-hover animate-fade-in-up"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg bg-purple-500/10 p-2.5 mt-0.5">
                            <Store className="h-5 w-5 text-purple-400" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{mkt.name}</span>
                              <HealthIndicator health={mkt.health} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{mkt.description}</p>
                            <div className="flex items-center gap-3 mt-2">
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <GitBranch className="h-3 w-3" />
                                <span className="font-mono">{mkt.path.replace(/\\/g, "/").split("/").slice(-2).join("/")}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {mktPluginCount} plugin{mktPluginCount !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Active Plugins grouped by category */}
          {sortedCategories.length > 0 && (
            <div className="space-y-6">
              {sortedCategories.map((category) => {
                const items = grouped[category];
                const isLSP = category === "lsp";
                return (
                  <div key={category} className="space-y-3">
                    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      {isLSP ? (
                        <Code2 className="h-3.5 w-3.5 text-indigo-400" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
                      )}
                      {CATEGORY_LABELS[category] || category}
                      <Badge variant="secondary" className="text-[10px] ml-1">{items.length}</Badge>
                    </h2>
                    {isLSP ? (
                      // Compact grid for LSP plugins
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                        {items.map((plugin, i) => (
                          <Card
                            key={plugin.id}
                            className="card-hover animate-fade-in-up"
                            style={{ animationDelay: `${i * 30}ms` }}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-center gap-2">
                                <Code2 className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0" />
                                <span className="font-medium text-sm truncate">{plugin.name}</span>
                              </div>
                              {plugin.description && (
                                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">{plugin.description}</p>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      items.map((plugin, i) => {
                        const data = plugin.data as any;
                        return (
                          <Card
                            key={plugin.id}
                            className="card-hover animate-fade-in-up"
                            style={{ animationDelay: `${i * 40}ms` }}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="rounded-md bg-purple-500/10 p-1.5">
                                    <Puzzle className="h-4 w-4 text-purple-400" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{plugin.name}</span>
                                      <HealthIndicator health={plugin.health} />
                                      {data.hasMCP && (
                                        <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400 gap-0.5">
                                          <Server className="h-2.5 w-2.5" /> MCP
                                        </Badge>
                                      )}
                                      {data.category && (
                                        <Badge
                                          variant="outline"
                                          className={`text-[10px] ${CATEGORY_COLORS[data.category] || "border-slate-500/30 text-slate-400"}`}
                                        >
                                          {data.category}
                                        </Badge>
                                      )}
                                    </div>
                                    {plugin.description && (
                                      <p className="text-xs text-muted-foreground mt-0.5">{plugin.description}</p>
                                    )}
                                    {!plugin.description && data.marketplace && (
                                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">@{data.marketplace}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-green-500" />
                                  <span className="text-[10px] text-green-400">Active</span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Blocked Plugins */}
          {blocked.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5 text-red-400" /> Blocked
              </h2>
              {blocked.map((plugin, i) => {
                const data = plugin.data as any;
                return (
                  <Card
                    key={plugin.id}
                    className="border-red-500/20 card-hover animate-fade-in-up"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="rounded-md bg-red-500/10 p-1.5">
                            <ShieldAlert className="h-4 w-4 text-red-400" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-red-400/80">{plugin.name}</span>
                              <Badge variant="destructive" className="text-[10px]">Blocked</Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {data.marketplace && (
                                <span className="text-xs text-muted-foreground font-mono">@{data.marketplace}</span>
                              )}
                              {data.blockReason && (
                                <span className="text-xs text-red-400/60">Reason: {data.blockReason}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] text-red-400">Blocked</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {active.length === 0 && blocked.length === 0 && marketplaces.length === 0 && (
            <div className="text-muted-foreground text-center py-12">No plugins found</div>
          )}
        </>
      )}
    </div>
  );
}
