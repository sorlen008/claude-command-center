import { useParams, Link, useLocation } from "wouter";
import { useProjectDetail } from "@/hooks/use-projects";
import { useMarkdownContent } from "@/hooks/use-markdown";
import { useSessions } from "@/hooks/use-sessions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityBadge, entityConfig } from "@/components/entity-badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, Server, Wand2, HardDrive, MessageSquare, ExternalLink, Edit3, ChevronRight, Layers, Zap, Clock, Terminal, Code2, Copy, X, Check } from "lucide-react";
import type { MCPEntity, SkillEntity, MarkdownEntity, ScriptEntity } from "@shared/types";
import { formatBytes, relativeTime } from "@/lib/utils";
import { useEffect, useState } from "react";

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const { data, isLoading } = useProjectDetail(params.id);
  const [, setLocation] = useLocation();

  const projectFilter = data?.project.data.projectKey || data?.project.path.split("/").pop() || "";
  const { data: sessionsData } = useSessions({ project: projectFilter, sort: "lastTs", order: "desc" });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (!data) return <div className="p-6 text-muted-foreground">Project not found</div>;

  const { project, linkedEntities } = data;
  const pdata = project.data;

  const mcps = linkedEntities.filter((e): e is MCPEntity => e.type === "mcp");
  const skills = linkedEntities.filter((e): e is SkillEntity => e.type === "skill");
  const markdowns = linkedEntities.filter((e): e is MarkdownEntity => e.type === "markdown");
  const scripts = linkedEntities.filter((e): e is ScriptEntity => e.type === "script");
  const scriptsSorted = scripts.slice().sort((a, b) => {
    const at = a.lastModified ? Date.parse(a.lastModified) : 0;
    const bt = b.lastModified ? Date.parse(b.lastModified) : 0;
    return bt - at;
  });
  const scriptCapped = Boolean(pdata.scriptCapped);
  const claudeMd = markdowns.find((m) => m.name === "CLAUDE.md");

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
          <TabsTrigger value="scripts">Scripts ({scripts.length}{scriptCapped ? "+" : ""})</TabsTrigger>
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
                    <Badge variant="outline" className="text-xs">{mcp.data.transport}</Badge>
                    {mcp.data.command && (
                      <code className="text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                        {mcp.data.command}
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
                  {skill.data.userInvocable && <Badge variant="outline" className="text-xs border-orange-500/30 text-orange-400">Invocable</Badge>}
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
                      <Badge variant="secondary" className="text-xs">{md.data.category}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">{formatBytes(md.data.sizeBytes)}</span>
                      <Edit3 className="h-3 w-3 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
          {markdowns.length === 0 && <p className="text-muted-foreground text-sm py-8 text-center">No markdown files linked to this project</p>}
        </TabsContent>

        <TabsContent value="scripts" className="space-y-2 mt-4">
          {scriptCapped && (
            <p className="text-[11px] text-amber-400/80">
              Showing the first {scripts.length} scripts found — additional files exist beyond the per-project cap.
            </p>
          )}
          {scriptsSorted.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No Python scripts found in this project. Files matching <code className="font-mono text-[11px] bg-muted/40 px-1 rounded">**/*.py</code> appear here once they're added.
            </p>
          ) : (
            scriptsSorted.map((script, i) => (
              <ScriptRow key={script.id} script={script} index={i} />
            ))
          )}
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

/**
 * One row in the project Scripts tab. Click expands a read-only source preview
 * fetched from /api/scripts/:id/source. Hover reveals a "copy absolute path" button.
 */
function ScriptRow({ script, index }: { script: ScriptEntity; index: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const docstring = script.data.docstring;

  return (
    <Card
      className="card-hover animate-fade-in-up"
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
    >
      <CardContent className="p-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-start gap-3 text-left"
          aria-expanded={open}
        >
          <div className="rounded-md bg-yellow-500/10 p-1.5 mt-0.5">
            <Code2 className="h-4 w-4 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium">{script.name}</span>
              <span className="text-[10px] text-muted-foreground/60 font-mono truncate" title={script.path}>
                {script.data.relativePath}
              </span>
            </div>
            {docstring && (
              <p className="text-xs text-muted-foreground mt-1 truncate italic">{docstring}</p>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
            <span className="font-mono">{formatBytes(script.data.sizeBytes)}</span>
            {script.lastModified && (
              <span title={new Date(script.lastModified).toLocaleString()}>
                {relativeTime(script.lastModified)}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(script.path);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="p-1 rounded hover:bg-muted/60"
              title="Copy absolute path"
              aria-label="Copy absolute path"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </button>

        {open && <ScriptSourcePreview scriptId={script.id} />}
      </CardContent>
    </Card>
  );
}

interface ScriptSourceResponse {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  lineCount: number;
  previewLines: number;
  truncated: boolean;
  content: string;
}

/** Lazy-loaded source viewer. Fetches only when the row is opened. */
function ScriptSourcePreview({ scriptId }: { scriptId: string }) {
  const [data, setData] = useState<ScriptSourceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scripts/${encodeURIComponent(scriptId)}/source`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((body: ScriptSourceResponse) => {
        if (!cancelled) setData(body);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [scriptId]);

  if (error) {
    return (
      <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
        Could not load source: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-3 text-xs text-muted-foreground/60">Loading source…</div>
    );
  }

  return (
    <div className="mt-3">
      {data.truncated && (
        <p className="text-[10px] text-amber-400/80 mb-1.5">
          Showing first {data.previewLines} of {data.lineCount} lines.
        </p>
      )}
      <pre className="text-[11px] font-mono leading-relaxed text-foreground/80 bg-muted/40 rounded-lg p-3 overflow-x-auto max-h-[420px] whitespace-pre border border-border/40">
        {data.content}
      </pre>
    </div>
  );
}
