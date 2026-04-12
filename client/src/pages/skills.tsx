import { useEntities, useRescan } from "@/hooks/use-entities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Wand2, Terminal, ChevronDown, ChevronRight, Copy, Check, Edit3, FolderOpen, RefreshCw, Settings, LayoutGrid } from "lucide-react";
import { ListSkeleton } from "@/components/skeleton";
import type { SkillEntity, MarkdownEntity } from "@shared/types";

const CATEGORY_LABELS: Record<string, string> = {
  services: "Services & Infrastructure",
  devops: "DevOps & CI/CD",
  quality: "Testing & Quality",
  git: "Git & Version Control",
  finance: "Finance & Data",
  communication: "Communication",
  automation: "Automation & Sync",
  media: "Media & Content",
  workflow: "Workflow & Sessions",
  ai: "AI & LLM",
  design: "Design & UI",
  data: "Data & Databases",
  project: "Project Management",
  general: "General",
};

const CATEGORY_COLORS: Record<string, string> = {
  services: "border-violet-500/30 text-violet-400",
  devops: "border-indigo-500/30 text-indigo-400",
  quality: "border-green-500/30 text-green-400",
  git: "border-orange-500/30 text-orange-400",
  finance: "border-cyan-500/30 text-cyan-400",
  communication: "border-pink-500/30 text-pink-400",
  automation: "border-amber-500/30 text-amber-400",
  media: "border-rose-500/30 text-rose-400",
  workflow: "border-blue-500/30 text-blue-400",
  ai: "border-emerald-500/30 text-emerald-400",
  design: "border-fuchsia-500/30 text-fuchsia-400",
  data: "border-teal-500/30 text-teal-400",
  project: "border-sky-500/30 text-sky-400",
  general: "border-slate-500/30 text-slate-400",
};

const GRID_CLASSES = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3";

function getSkillCategory(skill: SkillEntity): string {
  return (skill.data as { category?: string }).category || "general";
}

function compareCategories(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "general") return 1;
  if (b === "general") return -1;
  return a.localeCompare(b);
}

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
  const { data: skills, isLoading } = useEntities<SkillEntity>("skill");
  const { data: markdowns } = useEntities<MarkdownEntity>("markdown");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [, setLocation] = useLocation();
  const rescan = useRescan();

  const filtered = (skills || [])
    .filter(
      (s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description?.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const aInv = a.data.userInvocable ? 1 : 0;
      const bInv = b.data.userInvocable ? 1 : 0;
      if (bInv !== aInv) return bInv - aInv;
      return a.name.localeCompare(b.name);
    });

  const invocableCount = filtered.filter((s) => s.data.userInvocable).length;

  const grouped = groupByCategory
    ? filtered.reduce<Record<string, SkillEntity[]>>((acc, skill) => {
        const cat = getSkillCategory(skill);
        (acc[cat] ||= []).push(skill);
        return acc;
      }, {})
    : null;

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

  const handleEdit = (skill: SkillEntity, e: React.MouseEvent) => {
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
        <div className="flex items-center gap-2">
          <Button
            variant={groupByCategory ? "default" : "outline"}
            size="sm"
            onClick={() => setGroupByCategory(!groupByCategory)}
            className="gap-1.5 text-xs"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {groupByCategory ? "Grouped" : "Group"}
          </Button>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search skills..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <Wand2 className="h-12 w-12 text-muted-foreground/30" />
          <div className="text-center space-y-1">
            <p className="text-muted-foreground font-medium">No skills found</p>
            <p className="text-xs text-muted-foreground/70">
              Scanner looks in ~/.claude/skills/ for SKILL.md files
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
      ) : grouped ? (
        <div className="space-y-6">
          {Object.entries(grouped)
            .sort(([a], [b]) => compareCategories(a, b))
            .map(([category, items]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{CATEGORY_LABELS[category] || category}</h2>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CATEGORY_COLORS[category] || ""}`}>{items.length}</Badge>
                </div>
                <div className={GRID_CLASSES}>
                  {items.map((skill, i) => renderSkillCard(skill, i))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className={GRID_CLASSES}>
          {filtered.map((skill, i) => renderSkillCard(skill, i))}
        </div>
      )}
    </div>
  );

  function renderSkillCard(skill: SkillEntity, i: number) {
    const data = skill.data;
    const isExpanded = expanded === skill.id;
    const projectName = (data as Record<string, unknown>).projectName as string | undefined;
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
              <div className="rounded-md bg-gradient-to-br from-orange-500/15 to-amber-500/10 p-1.5 transition-shadow group-hover:shadow-[0_0_8px_rgba(249,115,22,0.2)]">
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
  }
}
