import { useLocation } from "wouter";
import { useRescan } from "@/hooks/use-entities";
import { useProjects } from "@/hooks/use-projects";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HealthIndicator } from "@/components/health-indicator";
import { useState } from "react";
import { Search, FolderOpen, FileText, Server, Wand2, HardDrive, MessageSquare, RefreshCw, Settings, Code2 } from "lucide-react";
import { formatBytes } from "@/lib/utils";

export default function Projects() {
  const [, setLocation] = useLocation();
  const { data: projects, isLoading } = useProjects();
  const rescan = useRescan();
  const [search, setSearch] = useState("");

  const filtered = (projects || [])
    .filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => (b.data.sessionCount || 0) - (a.data.sessionCount || 0));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} projects tracked</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading projects...</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((project, i) => {
            const pdata = project.data;
            const scriptCount = (pdata.scriptCount as number | undefined) || 0;
            const scriptCapped = Boolean(pdata.scriptCapped);
            // Entity breakdown bar data
            const total = (project.mcpCount || 0) + (project.skillCount || 0) + (project.markdownCount || 0) + scriptCount;
            return (
              <Card
                key={project.id}
                className="cursor-pointer card-hover border-l-[3px] border-l-blue-500 animate-fade-in-up"
                style={{ animationDelay: `${i * 40}ms` }}
                onClick={() => setLocation(`/projects/${project.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-blue-500/10 p-2 mt-0.5">
                        <FolderOpen className="h-5 w-5 text-blue-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-base">{project.name}</span>
                          <HealthIndicator health={project.health} />
                          {pdata.hasClaudeMd && (
                            <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 gap-0.5">
                              <FileText className="h-2.5 w-2.5" /> CLAUDE.md
                            </Badge>
                          )}
                        </div>
                        {project.description && (
                          <p className="text-xs text-muted-foreground mt-1">{project.description}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground/60 font-mono mt-0.5 truncate max-w-[400px]" title={project.path}>
                          {project.path}
                        </p>
                        {pdata.techStack && pdata.techStack.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {pdata.techStack.map((tech: string) => (
                              <Badge key={tech} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                {tech}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {/* Entity breakdown bar */}
                        {total > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            <div className="flex h-1.5 rounded-full overflow-hidden w-32">
                              {project.mcpCount > 0 && (
                                <div className="bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.4)]" style={{ width: `${(project.mcpCount / total) * 100}%` }} />
                              )}
                              {project.skillCount > 0 && (
                                <div className="bg-orange-500 shadow-[0_0_4px_rgba(249,115,22,0.4)]" style={{ width: `${(project.skillCount / total) * 100}%` }} />
                              )}
                              {project.markdownCount > 0 && (
                                <div className="bg-slate-500 shadow-[0_0_4px_rgba(100,116,139,0.4)]" style={{ width: `${(project.markdownCount / total) * 100}%` }} />
                              )}
                              {scriptCount > 0 && (
                                <div className="bg-yellow-500 shadow-[0_0_4px_rgba(234,179,8,0.4)]" style={{ width: `${(scriptCount / total) * 100}%` }} />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {project.mcpCount > 0 && (
                        <div className="flex items-center gap-1" title="MCP Servers">
                          <Server className="h-3.5 w-3.5 text-green-400" />
                          <span>{project.mcpCount}</span>
                        </div>
                      )}
                      {project.skillCount > 0 && (
                        <div className="flex items-center gap-1" title="Skills">
                          <Wand2 className="h-3.5 w-3.5 text-orange-400" />
                          <span>{project.skillCount}</span>
                        </div>
                      )}
                      {project.markdownCount > 0 && (
                        <div className="flex items-center gap-1" title="Markdown files">
                          <FileText className="h-3.5 w-3.5 text-slate-400" />
                          <span>{project.markdownCount}</span>
                        </div>
                      )}
                      {scriptCount > 0 && (
                        <div className="flex items-center gap-1" title={scriptCapped ? `Scripts (capped at ${scriptCount}+)` : "Scripts"}>
                          <Code2 className="h-3.5 w-3.5 text-yellow-400" />
                          <span>{scriptCount}{scriptCapped ? "+" : ""}</span>
                        </div>
                      )}
                      <div className="border-l border-border pl-4 flex items-center gap-3">
                        <div className="flex items-center gap-1" title="Sessions">
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span className="font-mono">{pdata.sessionCount}</span>
                        </div>
                        <div className="flex items-center gap-1" title="Storage">
                          <HardDrive className="h-3.5 w-3.5" />
                          <span className="font-mono">{formatBytes(pdata.sessionSize)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <FolderOpen className="h-12 w-12 text-muted-foreground/30" />
              <div className="text-center space-y-1">
                <p className="text-muted-foreground font-medium">No projects found</p>
                <p className="text-xs text-muted-foreground/70">
                  Scanner looks in HOME for directories with CLAUDE.md, .mcp.json, .git, or package.json
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => rescan.mutate()} disabled={rescan.isPending} className="gap-1.5">
                  <RefreshCw className={`h-3.5 w-3.5 ${rescan.isPending ? "animate-spin" : ""}`} />
                  Rescan
                </Button>
                <Button variant="outline" size="sm" onClick={() => setLocation("/settings")} className="gap-1.5">
                  <Settings className="h-3.5 w-3.5" />
                  Configure Paths
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
