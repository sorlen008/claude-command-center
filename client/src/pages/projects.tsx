import { useLocation } from "wouter";
import { useProjects } from "@/hooks/use-entities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { HealthIndicator } from "@/components/health-indicator";
import { useState } from "react";
import { Search, FolderOpen, FileText, Server, Wand2, HardDrive, MessageSquare } from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export default function Projects() {
  const [, setLocation] = useLocation();
  const { data: projects, isLoading } = useProjects();
  const [search, setSearch] = useState("");

  const filtered = (projects || [])
    .filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.description?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => ((b.data as any).sessionCount || 0) - ((a.data as any).sessionCount || 0));

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
            const pdata = project.data as any;
            // Entity breakdown bar data
            const total = (project.mcpCount || 0) + (project.skillCount || 0) + (project.markdownCount || 0);
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
                            <div className="flex h-1 rounded-full overflow-hidden w-32">
                              {project.mcpCount > 0 && (
                                <div className="bg-green-500" style={{ width: `${(project.mcpCount / total) * 100}%` }} />
                              )}
                              {project.skillCount > 0 && (
                                <div className="bg-orange-500" style={{ width: `${(project.skillCount / total) * 100}%` }} />
                              )}
                              {project.markdownCount > 0 && (
                                <div className="bg-slate-500" style={{ width: `${(project.markdownCount / total) * 100}%` }} />
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
            <div className="text-muted-foreground text-center py-12">No projects found</div>
          )}
        </div>
      )}
    </div>
  );
}
