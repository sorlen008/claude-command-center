import { useParams, Link, useLocation } from "wouter";
import { useProjectDetail, useMarkdownContent, useSessions } from "@/hooks/use-entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityBadge, entityConfig } from "@/components/entity-badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Server, Wand2, HardDrive, MessageSquare, ExternalLink, Edit3, ChevronRight, Layers, Zap, Clock, Terminal } from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const { data, isLoading } = useProjectDetail(params.id);
  const [, setLocation] = useLocation();

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="p-6 text-muted-foreground">Project not found</div>;

  const { project, linkedEntities } = data;
  const pdata = project.data as any;

  const mcps = linkedEntities.filter((e) => e.type === "mcp");
  const skills = linkedEntities.filter((e) => e.type === "skill");
  const markdowns = linkedEntities.filter((e) => e.type === "markdown");
  const claudeMd = markdowns.find((m) => m.name === "CLAUDE.md");

  // Sessions for this project
  const projectFilter = pdata.projectKey || project.path.split("/").pop() || project.path.split("\\").pop() || "";
  const { data: sessionsData } = useSessions({ project: projectFilter, sort: "lastTs", order: "desc" });
  const projectSessions = sessionsData?.sessions || [];

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">Projects</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">{project.name}</span>
      </div>

      <div className="flex items-center gap-3">
        <Link href="/projects">
          <Button variant="ghost" size="icon" aria-label="Back to projects"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{pdata.projectKey}</p>
          {pdata.techStack && pdata.techStack.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {pdata.techStack.map((tech: string) => (
                <Badge key={tech} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {tech}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="gap-1">
          <MessageSquare className="h-3 w-3" /> {pdata.sessionCount} sessions
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <HardDrive className="h-3 w-3" /> {formatBytes(pdata.sessionSize)}
        </Badge>
        {pdata.hasClaudeMd && (
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 gap-1">
            <FileText className="h-3 w-3" /> CLAUDE.md
          </Badge>
        )}
        {pdata.hasMemory && (
          <Badge variant="outline" className="border-purple-500/30 text-purple-400">Memory</Badge>
        )}
        {mcps.length > 0 && (
          <Badge variant="outline" className="border-green-500/30 text-green-400 gap-1">
            <Server className="h-3 w-3" /> {mcps.length} MCP
          </Badge>
        )}
        {skills.length > 0 && (
          <Badge variant="outline" className="border-orange-500/30 text-orange-400 gap-1">
            <Wand2 className="h-3 w-3" /> {skills.length} Skills
          </Badge>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="mcps">MCPs ({mcps.length})</TabsTrigger>
          <TabsTrigger value="skills">Skills ({skills.length})</TabsTrigger>
          <TabsTrigger value="markdown">Markdown ({markdowns.length})</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({projectSessions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {pdata.longDescription && (
            <Card className="card-hover border-l-[3px] border-l-blue-500/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Layers className="h-4 w-4 text-blue-400" /> About
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{pdata.longDescription}</p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="card-hover">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Details</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Project path</span>
                  <span className="font-mono text-xs">{project.path}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Session storage</span>
                  <span className="font-mono">{formatBytes(pdata.sessionSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last activity</span>
                  <span className="font-mono text-xs">{project.lastModified ? new Date(project.lastModified).toLocaleString() : "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Health</span>
                  <span className={`font-mono ${project.health === "ok" ? "text-green-400" : "text-yellow-400"}`}>{project.health}</span>
                </div>
                {pdata.keyFeatures && pdata.keyFeatures.length > 0 && (
                  <div className="pt-2 border-t border-border/50">
                    <span className="text-muted-foreground flex items-center gap-1 mb-1.5">
                      <Zap className="h-3 w-3" /> Key Features
                    </span>
                    <ul className="space-y-1">
                      {pdata.keyFeatures.map((f: string, idx: number) => (
                        <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <span className="text-blue-400 mt-0.5">-</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="card-hover">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Linked Entities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Server className="h-3.5 w-3.5 text-green-400" /> MCP Servers
                  </div>
                  <span className="font-mono text-sm">{mcps.length}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Wand2 className="h-3.5 w-3.5 text-orange-400" /> Skills
                  </div>
                  <span className="font-mono text-sm">{skills.length}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-3.5 w-3.5 text-slate-400" /> Markdown Files
                  </div>
                  <span className="font-mono text-sm">{markdowns.length}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {claudeMd && <ClaudeMdPreview entityId={claudeMd.id} />}
        </TabsContent>

        <TabsContent value="mcps" className="space-y-3 mt-4">
          {mcps.map((mcp, i) => (
            <Card
              key={mcp.id}
              className="card-hover animate-fade-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <EntityBadge type="mcp" />
                    <span className="font-medium">{mcp.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{(mcp.data as any).transport}</Badge>
                    {(mcp.data as any).command && (
                      <code className="text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                        {(mcp.data as any).command}
                      </code>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {mcps.length === 0 && <p className="text-muted-foreground text-sm py-8 text-center">No MCP servers linked to this project</p>}
        </TabsContent>

        <TabsContent value="skills" className="space-y-3 mt-4">
          {skills.map((skill, i) => (
            <Card
              key={skill.id}
              className="card-hover animate-fade-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <EntityBadge type="skill" />
                    <span className="font-medium">/{skill.name}</span>
                  </div>
                  {(skill.data as any).userInvocable && <Badge variant="outline" className="text-xs border-orange-500/30 text-orange-400">Invocable</Badge>}
                </div>
                {skill.description && <p className="text-xs text-muted-foreground mt-2">{skill.description}</p>}
              </CardContent>
            </Card>
          ))}
          {skills.length === 0 && <p className="text-muted-foreground text-sm py-8 text-center">No skills linked to this project</p>}
        </TabsContent>

        <TabsContent value="markdown" className="space-y-3 mt-4">
          {markdowns.map((md, i) => (
            <button
              key={md.id}
              className="w-full text-left"
              onClick={() => setLocation(`/markdown/${md.id}`)}
            >
              <Card
                className="card-hover cursor-pointer animate-fade-in-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <EntityBadge type="markdown" />
                      <span className="font-medium">{md.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">{(md.data as any).category}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">{formatBytes((md.data as any).sizeBytes)}</span>
                      <Edit3 className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
          {markdowns.length === 0 && <p className="text-muted-foreground text-sm py-8 text-center">No markdown files linked to this project</p>}
        </TabsContent>

        <TabsContent value="sessions" className="space-y-3 mt-4">
          {projectSessions.slice(0, 20).map((s, i) => (
            <Card
              key={s.id}
              className="card-hover animate-fade-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <MessageSquare className="h-3.5 w-3.5 text-cyan-400 flex-shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {s.firstMessage || "(empty session)"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {s.lastTs ? relativeTime(s.lastTs) : "-"}
                    </span>
                    <span className="font-mono">{s.messageCount} msgs</span>
                    <span className="font-mono">{formatBytes(s.sizeBytes)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {projectSessions.length > 20 && (
            <button
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors w-full text-center py-2"
              onClick={() => setLocation(`/sessions?project=${encodeURIComponent(projectFilter)}`)}
            >
              View all {projectSessions.length} sessions →
            </button>
          )}
          {projectSessions.length === 0 && <p className="text-muted-foreground text-sm py-8 text-center">No sessions found for this project</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ClaudeMdPreview({ entityId }: { entityId: string }) {
  const { data } = useMarkdownContent(entityId);
  const [, setLocation] = useLocation();

  if (!data) return null;

  const content = (data as any).content as string;
  if (!content) return null;

  const preview = content.split("\n").slice(0, 30).join("\n");
  const truncated = content.split("\n").length > 30;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-400" />
            CLAUDE.md Preview
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1 h-7"
            onClick={() => setLocation(`/markdown/${entityId}`)}
          >
            <Edit3 className="h-3 w-3" /> Edit
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="text-[11px] font-mono leading-relaxed text-muted-foreground bg-muted/50 rounded-lg p-4 overflow-x-auto max-h-64 whitespace-pre-wrap border border-border/50">
          {preview}
        </pre>
        {truncated && (
          <p className="text-[11px] text-muted-foreground mt-2 text-center">
            ... {content.split("\n").length - 30} more lines
          </p>
        )}
      </CardContent>
    </Card>
  );
}
