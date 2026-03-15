import { useLocation } from "wouter";
import { useMarkdownFiles, useRuntimeConfig, makeRelativePath } from "@/hooks/use-entities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState } from "react";
import { Search, FileText, Edit3, Clock } from "lucide-react";

const categories = ["all", "claude-md", "memory", "skill", "readme", "other"] as const;

const categoryConfig: Record<string, { color: string; label: string }> = {
  "claude-md": { color: "border-blue-500/30 text-blue-400 bg-blue-500/5", label: "CLAUDE.md" },
  memory: { color: "border-purple-500/30 text-purple-400 bg-purple-500/5", label: "Memory" },
  skill: { color: "border-orange-500/30 text-orange-400 bg-orange-500/5", label: "Skill" },
  readme: { color: "border-green-500/30 text-green-400 bg-green-500/5", label: "README" },
  other: { color: "border-slate-500/30 text-slate-400 bg-slate-500/5", label: "Other" },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

// Max size for visualization bar
const MAX_SIZE_BYTES = 50 * 1024; // 50KB

export default function MarkdownFiles() {
  const [, setLocation] = useLocation();
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const { data: files, isLoading } = useMarkdownFiles(category === "all" ? undefined : category);
  const { data: runtimeConfig } = useRuntimeConfig();
  const homeDir = runtimeConfig?.homeDir || null;
  const relativePath = (p: string) => makeRelativePath(p, homeDir);

  const filtered = (files || []).filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.path.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = category === "all"
    ? Object.entries(
        filtered.reduce((acc, f) => {
          const cat = (f.data as any).category || "other";
          if (!acc[cat]) acc[cat] = [];
          acc[cat].push(f);
          return acc;
        }, {} as Record<string, typeof filtered>)
      ).sort(([a], [b]) => {
        const order = ["claude-md", "memory", "skill", "readme", "other"];
        return order.indexOf(a) - order.indexOf(b);
      })
    : [["", filtered] as const];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Markdown Files</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} files found</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search files..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Tabs value={category} onValueChange={setCategory}>
        <TabsList>
          {categories.map((c) => {
            const config = categoryConfig[c];
            return (
              <TabsTrigger key={c} value={c} className="text-xs">
                {c === "all" ? "All" : config?.label || c}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading files...</div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([groupName, groupFiles]) => (
            <div key={groupName || "all"}>
              {category === "all" && groupName && (
                <div className="flex items-center gap-2 mb-2">
                  <Badge
                    variant="outline"
                    className={`text-xs ${categoryConfig[groupName]?.color || ""}`}
                  >
                    {categoryConfig[groupName]?.label || groupName}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{groupFiles.length}</span>
                  <div className="flex-1 border-t border-border/30" />
                </div>
              )}
              <div className="space-y-1.5">
                {groupFiles.map((file, i) => {
                  const data = file.data as any;
                  const config = categoryConfig[data.category];
                  const sizePercent = Math.min((data.sizeBytes / MAX_SIZE_BYTES) * 100, 100);
                  return (
                    <Tooltip key={file.id}>
                      <TooltipTrigger asChild>
                        <button
                          className="w-full text-left rounded-lg border border-border/50 px-4 py-3 hover:bg-accent/30 hover:border-border transition-all duration-150 flex items-center gap-3 group card-hover animate-fade-in-up"
                          style={{ animationDelay: `${i * 20}ms` }}
                          onClick={() => setLocation(`/markdown/${file.id}`)}
                        >
                          <FileText className={`h-4 w-4 flex-shrink-0 ${config?.color.split(" ").find(c => c.startsWith("text-")) || "text-slate-400"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{file.name}</span>
                              {category === "all" ? null : (
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config?.color || ""}`}>
                                  {config?.label || data.category}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                              {relativePath(file.path)}
                            </p>
                          </div>
                          <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-shrink-0">
                            {/* Size visualization bar */}
                            <div className="flex items-center gap-1.5">
                              <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-muted-foreground/30"
                                  style={{ width: `${sizePercent}%` }}
                                />
                              </div>
                              <span className="font-mono tabular-nums w-14 text-right">{formatSize(data.sizeBytes)}</span>
                            </div>
                            <span className="font-mono tabular-nums flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {file.lastModified ? new Date(file.lastModified).toLocaleDateString() : ""}
                            </span>
                            <Edit3 className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </button>
                      </TooltipTrigger>
                      {data.preview && (
                        <TooltipContent side="bottom" className="max-w-sm">
                          <pre className="text-[10px] font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-hidden">
                            {data.preview.slice(0, 300)}
                            {data.preview.length > 300 ? "..." : ""}
                          </pre>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-muted-foreground text-center py-12">No files found</div>}
        </div>
      )}
    </div>
  );
}
