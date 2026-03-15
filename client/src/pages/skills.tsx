import { useEntities } from "@/hooks/use-entities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Wand2, Terminal, ChevronDown, ChevronRight, Copy, Check, Edit3, FolderOpen } from "lucide-react";
import { ListSkeleton } from "@/components/skeleton";

function formatPreview(content: string): string {
  // Extract first meaningful paragraph, skip headers and blank lines
  const lines = content.split("\n");
  const paragraphs: string[] = [];
  let current = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (current) {
        paragraphs.push(current.trim());
        current = "";
      }
    } else if (!trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      current += (current ? " " : "") + trimmed;
    }
  }
  if (current) paragraphs.push(current.trim());
  return paragraphs.slice(0, 3).join("\n\n") || content.slice(0, 300);
}

export default function Skills() {
  const { data: skills, isLoading } = useEntities("skill");
  const { data: markdowns } = useEntities("markdown");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const filtered = (skills || [])
    .filter(
      (s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aInv = (a.data as any).userInvocable ? 1 : 0;
      const bInv = (b.data as any).userInvocable ? 1 : 0;
      if (bInv !== aInv) return bInv - aInv;
      return a.name.localeCompare(b.name);
    });

  const invocableCount = filtered.filter((s) => (s.data as any).userInvocable).length;

  const handleCopy = (name: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`/${name}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const findMarkdownId = (skillPath: string) => {
    if (!markdowns) return null;
    const normalizedSkillPath = skillPath.replace(/\\/g, "/");
    return markdowns.find((m) => m.path.replace(/\\/g, "/") === normalizedSkillPath)?.id ?? null;
  };

  const handleEdit = (skill: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const mdId = findMarkdownId(skill.path);
    if (mdId) {
      setLocation(`/markdown/${mdId}`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Skills</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {invocableCount} invocable, {filtered.length} total
          </p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search skills..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((skill, i) => {
            const data = skill.data as any;
            const isExpanded = expanded === skill.id;
            const projectName = data.projectName as string | undefined;
            const mdId = findMarkdownId(skill.path);
            return (
              <Card
                key={skill.id}
                className="cursor-pointer card-hover group animate-fade-in-up"
                style={{ animationDelay: `${i * 30}ms` }}
                onClick={() => setExpanded(isExpanded ? null : skill.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-gradient-to-br from-orange-500/15 to-amber-500/10 p-1.5">
                        <Wand2 className="h-3.5 w-3.5 text-orange-400" />
                      </div>
                      <span className="font-semibold text-sm">/{skill.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {data.userInvocable && (
                        <Badge variant="outline" className="text-[10px] px-1.5 border-orange-500/30 text-orange-400">
                          invocable
                        </Badge>
                      )}
                      {mdId && (
                        <button
                          onClick={(e) => handleEdit(skill, e)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                          title="Edit SKILL.md"
                          aria-label="Edit skill"
                        >
                          <Edit3 className="h-3 w-3 text-muted-foreground" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleCopy(skill.name, skill.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                        title="Copy command"
                        aria-label="Copy command"
                      >
                        {copiedId === skill.id ? (
                          <Check className="h-3 w-3 text-green-400" />
                        ) : (
                          <Copy className="h-3 w-3 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </div>

                  {skill.description && (
                    <p className="text-xs text-muted-foreground mb-2 leading-relaxed line-clamp-2">{skill.description}</p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    {data.args && (
                      <div className="flex items-start gap-1.5 text-[11px] font-mono text-muted-foreground bg-muted/50 rounded-md px-2 py-1.5">
                        <Terminal className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span className="break-all">{data.args}</span>
                      </div>
                    )}
                    {projectName && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <FolderOpen className="h-3 w-3" />
                        <span>{projectName}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-center mt-2 text-muted-foreground/50">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </div>

                  {isExpanded && data.content && (
                    <div className="mt-2 p-3 bg-muted rounded-md text-[11px] overflow-x-auto max-h-64 whitespace-pre-wrap leading-relaxed border border-border/50">
                      {formatPreview(data.content)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && <div className="text-muted-foreground text-center py-12 col-span-full">No skills found</div>}
        </div>
      )}
    </div>
  );
}
