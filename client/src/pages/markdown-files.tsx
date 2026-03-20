import { useLocation } from "wouter";
import { makeRelativePath } from "@/hooks/use-entities";
import { useMarkdownFiles, useMarkdownContent, useSaveMarkdown } from "@/hooks/use-markdown";
import { useRuntimeConfig } from "@/hooks/use-config";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Search, FileText, Edit3, Clock, AlertTriangle, HelpCircle, ChevronDown, ChevronRight, CheckCircle, Clipboard, Check, Wrench, Save, Link2, CircleDot } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import MemoryDiagram from "@/components/memory-diagram";

const memoryTypeColors: Record<string, string> = {
  feedback: "border-amber-500/30 text-amber-400 bg-amber-500/5",
  project: "border-blue-500/30 text-blue-400 bg-blue-500/5",
  reference: "border-green-500/30 text-green-400 bg-green-500/5",
  user: "border-purple-500/30 text-purple-400 bg-purple-500/5",
};

function lineCountColor(n: number): string {
  if (n < 50) return "text-green-400";
  if (n <= 100) return "text-amber-400";
  return "text-red-400";
}

function getCardDisplay(file: any, homeDir: string | null): { title: string; subtitle: string; badge: string; badgeColor: string; slash?: string } {
  const data = file.data;
  const fm = data.frontmatter as Record<string, unknown> | null;
  const cat = data.category;
  const config = categoryConfig[cat];
  const rp = makeRelativePath(file.path, homeDir);

  if (cat === "memory") {
    const memType = typeof fm?.type === "string" ? fm.type : "";
    const isIndex = file.name === "MEMORY.md";
    const title = typeof fm?.name === "string" ? fm.name : file.name;
    const subtitle = typeof fm?.description === "string" ? fm.description : rp;
    const badge = isIndex ? "Index" : memType ? memType.charAt(0).toUpperCase() + memType.slice(1) : "Memory";
    const badgeColor = isIndex ? "border-slate-500/30 text-slate-400 bg-slate-500/5" : memoryTypeColors[memType] || config.color;
    return { title, subtitle, badge, badgeColor };
  }
  if (cat === "claude-md") {
    const normalized = file.path.replace(/\\/g, "/");
    const home = (homeDir || "").replace(/\\/g, "/");
    const title = normalized === `${home}/CLAUDE.md` ? "Home (root)" : (normalized.replace(/\/CLAUDE\.md$/, "").split("/").pop() || "").replace(/[-_]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || file.name;
    return { title, subtitle: rp, badge: "CLAUDE.md", badgeColor: config.color };
  }
  if (cat === "skill") {
    const subtitle = typeof fm?.description === "string" ? fm.description : rp;
    const parts = file.path.replace(/\\/g, "/").split("/");
    const si = parts.indexOf("skills");
    const slash = si >= 0 && parts[si + 1] ? `/${parts[si + 1]}` : undefined;
    return { title: file.name, subtitle, badge: "Skill", badgeColor: config.color, slash };
  }
  return { title: file.name, subtitle: rp, badge: config?.label || cat, badgeColor: config?.color || "" };
}

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

interface MemoryHealth {
  status: "healthy" | "attention" | "issues";
  label: string;
  issues: string[];
  noFrontmatter: Array<{ name: string; path: string }>;
  memoryMdLines: number;
  memoryMdMissing: boolean;
  overSized: Array<{ name: string; lines: number }>;
  staleFiles: Array<{ name: string; daysOld: number; path: string }>;
  totalLines: number;
  fileCount: number;
}

function analyzeMemoryHealth(files: any[], homeDir: string | null): MemoryHealth {
  const memFiles = files.filter(f => f.data.category === "memory");
  const claudeMdFiles = files.filter(f => f.data.category === "claude-md");
  const memoryMd = memFiles.find(f => f.name === "MEMORY.md");
  const memoryOther = memFiles.filter(f => f !== memoryMd);

  const noFrontmatter = memoryOther.filter(f => !f.data.frontmatter).map(f => ({ name: f.name, path: makeRelativePath(f.path, homeDir) }));
  const memoryMdLines = memoryMd?.data.lineCount || 0;
  const memoryMdMissing = !memoryMd;
  const overSized = memoryOther.filter(f => (f.data.lineCount || 0) > 150).map(f => ({ name: f.name, lines: f.data.lineCount || 0 }));
  const staleFiles = memoryOther.filter(f => {
    if (!f.lastModified) return false;
    return Math.floor((Date.now() - new Date(f.lastModified).getTime()) / 86400000) > 60;
  }).map(f => ({ name: f.name, daysOld: Math.floor((Date.now() - new Date(f.lastModified).getTime()) / 86400000), path: makeRelativePath(f.path, homeDir) }));

  const totalMemLines = memFiles.reduce((s, f) => s + (f.data.lineCount || 0), 0);
  const totalClaudeLines = claudeMdFiles.reduce((s, f) => s + (f.data.lineCount || 0), 0);
  const totalLines = totalMemLines + totalClaudeLines;

  const issues: string[] = [];
  if (memoryMdMissing) issues.push("MEMORY.md index file is missing");
  if (memoryMdLines > 150) issues.push(`MEMORY.md is ${memoryMdLines}/200 lines (near limit)`);
  if (noFrontmatter.length > 0) issues.push(`${noFrontmatter.length} file${noFrontmatter.length > 1 ? "s" : ""} missing frontmatter`);
  if (overSized.length > 0) issues.push(`${overSized.length} file${overSized.length > 1 ? "s" : ""} over 150 lines`);
  if (staleFiles.length > 0) issues.push(`${staleFiles.length} file${staleFiles.length > 1 ? "s" : ""} older than 60 days`);
  if (totalLines > 1500) issues.push(`Total ${totalLines} always-loaded lines (high)`);

  const status = issues.length === 0 ? "healthy" : issues.length <= 2 ? "attention" : "issues";
  const label = status === "healthy"
    ? `${memoryOther.length} files, ${totalMemLines} lines, MEMORY.md ${memoryMdLines}/200`
    : issues.join(" · ");

  return { status, label, issues, noFrontmatter, memoryMdLines, memoryMdMissing, overSized, staleFiles, totalLines, fileCount: memoryOther.length };
}

function generateFixPrompt(health: MemoryHealth): string {
  if (health.issues.length === 0) return "";
  const parts: string[] = ["Review and organize my Claude Code memory files. Here's what needs attention:\n"];
  let n = 1;

  if (health.noFrontmatter.length > 0) {
    parts.push(`${n}. These files are missing frontmatter (name, description, type):`);
    for (const f of health.noFrontmatter) parts.push(`   - ${f.path}`);
    parts.push("   Add appropriate frontmatter to each.\n");
    n++;
  }
  if (health.memoryMdMissing) {
    parts.push(`${n}. MEMORY.md index file is missing. Create one with links to all memory files.\n`);
    n++;
  }
  if (health.memoryMdLines > 150) {
    parts.push(`${n}. MEMORY.md is ${health.memoryMdLines} lines (limit is 200). Trim it to a pure index — one line per memory file with a link and brief description. Move any inline content to topic files.\n`);
    n++;
  }
  if (health.overSized.length > 0) {
    parts.push(`${n}. These files are over 150 lines and may contain code-derivable content:`);
    for (const f of health.overSized) parts.push(`   - ${f.name} (${f.lines} lines)`);
    parts.push("   Review and trim. Keep only decisions, lessons, and gotchas. Remove anything that can be found by reading the code.\n");
    n++;
  }
  if (health.staleFiles.length > 0) {
    parts.push(`${n}. These files haven't been updated in over 60 days:`);
    for (const f of health.staleFiles) parts.push(`   - ${f.name} (${f.daysOld} days old)`);
    parts.push("   Check if still relevant. Delete or update.\n");
    n++;
  }

  parts.push("After cleanup, verify MEMORY.md is under 100 lines and all files have frontmatter.");
  return parts.join("\n");
}

/** Fix It modal — shows issues and a copy-paste prompt */
function FixItModal({ open, onClose, health }: { open: boolean; onClose: () => void; health: MemoryHealth }) {
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => generateFixPrompt(health), [health]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-amber-400" />
            Get Organized
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {health.issues.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-3" />
              <p className="text-sm font-medium">Your memory files are well-organized</p>
              <p className="text-xs text-muted-foreground mt-1">No action needed.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium">Issues detected ({health.issues.length})</p>
                {health.issues.map((issue, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                    {issue}
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">Paste this into Claude Code to organize your memory files automatically:</p>
                <div className="relative">
                  <pre className="bg-muted/50 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto border border-border/50">{prompt}</pre>
                  <Button size="sm" variant="outline" className="absolute top-2 right-2 gap-1.5" onClick={() => { navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                    {copied ? <Check className="h-3 w-3 text-green-400" /> : <Clipboard className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Learn section — collapsible guide about how memory works */
function MemoryLearnGuide({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
        <HelpCircle className="h-4 w-4" />
        How Claude Code Memory Works
        {show ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {show && (
        <div className="px-4 pb-4 space-y-4 text-sm border-t border-cyan-500/10 pt-3">
          {/* Interactive diagram */}
          <div className="rounded-lg border border-border/30 bg-muted/20 p-2">
            <p className="text-[10px] text-muted-foreground/60 text-center mb-1">Hover over any element for details</p>
            <MemoryDiagram />
          </div>

          <div className="border-t border-border/30 pt-3">
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Detailed Reference</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">What gets loaded every session</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li><strong className="text-foreground">CLAUDE.md</strong> — project instructions, loaded in full when you're in that directory</li>
              <li><strong className="text-foreground">MEMORY.md</strong> — the index file, loaded every session. <span className="text-red-400">Hard limit: 200 lines</span> — anything beyond is invisible to Claude</li>
              <li><strong className="text-foreground">All memory files</strong> linked from MEMORY.md — loaded every session regardless of relevance</li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">Memory file types</h4>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400 flex-shrink-0">Feedback</Badge><span className="text-muted-foreground">Corrections you gave Claude. Prevents repeating mistakes.</span></div>
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 flex-shrink-0">Project</Badge><span className="text-muted-foreground">Ongoing work context — goals, decisions, status.</span></div>
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-400 flex-shrink-0">Reference</Badge><span className="text-muted-foreground">Pointers to external resources — IPs, URLs, dashboards.</span></div>
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400 flex-shrink-0">User</Badge><span className="text-muted-foreground">Info about you — role, expertise, preferences.</span></div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">File structure</h4>
            <p className="text-xs text-muted-foreground mb-1">Every memory file should have frontmatter at the top:</p>
            <pre className="bg-muted/50 rounded p-2 text-[11px] font-mono">{"---\nname: Human-readable title\ndescription: One-line summary\ntype: feedback | project | reference | user\n---"}</pre>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-2">
              <p className="text-green-400 font-medium text-xs mb-1">Save</p>
              <ul className="text-muted-foreground text-[11px] space-y-0.5">
                <li>Decisions and why</li>
                <li>Lessons learned</li>
                <li>Feedback / preferences</li>
                <li>External references</li>
              </ul>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2">
              <p className="text-red-400 font-medium text-xs mb-1">Don't save</p>
              <ul className="text-muted-foreground text-[11px] space-y-0.5">
                <li>File paths / code structure</li>
                <li>Endpoint lists / git history</li>
                <li>Anything already in CLAUDE.md</li>
              </ul>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">Guidelines</h4>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>MEMORY.md is an index, not a diary — one line per file, keep under 100 lines</li>
              <li>Individual files: aim for under 100 lines, soft max 150</li>
              <li>One topic per file. Cross-reference instead of duplicating.</li>
              <li>Update existing files instead of creating new ones</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/** Quick-Edit Drawer — slide-out editor for fast edits without leaving the list */
function QuickEditDrawer({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const { data: file, isLoading } = useMarkdownContent(fileId || undefined);
  const saveMutation = useSaveMarkdown();
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (file?.content) {
      setContent(file.content);
      setDirty(false);
    }
  }, [file?.content]);

  const handleSave = useCallback(() => {
    if (!fileId || !dirty) return;
    saveMutation.mutate(
      { id: fileId, content },
      {
        onSuccess: () => {
          setDirty(false);
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2000);
        },
      }
    );
  }, [fileId, content, dirty, saveMutation]);

  useEffect(() => {
    if (!fileId) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fileId, handleSave]);

  const fm = file?.data?.frontmatter as Record<string, unknown> | null;
  const memType = typeof fm?.type === "string" ? fm.type : "";
  const badgeColor = memType ? memoryTypeColors[memType] || "" : categoryConfig[file?.data?.category || ""]?.color || "";

  return (
    <Sheet open={!!fileId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[500px] sm:max-w-[500px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badgeColor}`}>
              {file?.data?.category || ""}
            </Badge>
            <SheetTitle className="text-sm">{file?.name || "Loading..."}</SheetTitle>
            {dirty && <Badge variant="secondary" className="text-[10px]">Unsaved</Badge>}
            {justSaved && <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400 gap-1"><Check className="h-2 w-2" /> Saved</Badge>}
          </div>
          <SheetDescription className="text-[11px] font-mono">{file?.path || ""}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 px-6 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              className="w-full h-full bg-muted/30 border border-border/50 rounded-lg p-3 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
            />
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-t border-border/50">
          <span className="text-[11px] text-muted-foreground">
            {file?.data?.lineCount || 0} lines · {file?.data?.sizeBytes ? formatSize(file.data.sizeBytes) : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty || saveMutation.isPending} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
              <kbd className="text-[9px] font-mono opacity-60 ml-0.5">Ctrl+S</kbd>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Analyze file dependency graph from link data */
function buildDependencyGraph(files: any[]): { edges: Array<{ source: string; target: string; sourceId: string; targetId: string }>; orphans: string[]; hubs: Array<{ name: string; count: number }> } {
  const edges: Array<{ source: string; target: string; sourceId: string; targetId: string }> = [];
  const inboundCount = new Map<string, number>();
  const fileByName = new Map<string, { id: string; name: string }>();

  // Build name lookup
  for (const f of files) {
    fileByName.set(f.name.toLowerCase(), { id: f.id, name: f.name });
  }

  // Build edges from links
  for (const f of files) {
    const links = f.data?.links as string[] | undefined;
    if (!links) continue;
    for (const link of links) {
      const targetName = link.split("/").pop()?.toLowerCase() || "";
      const target = fileByName.get(targetName);
      if (target && target.id !== f.id) {
        edges.push({ source: f.name, target: target.name, sourceId: f.id, targetId: target.id });
        inboundCount.set(target.name, (inboundCount.get(target.name) || 0) + 1);
      }
    }
  }

  // Find orphans (no inbound links, excluding MEMORY.md itself)
  const orphans = files
    .filter(f => f.name !== "MEMORY.md" && !inboundCount.has(f.name))
    .map(f => f.name);

  // Find hubs (3+ inbound links)
  const hubs = Array.from(inboundCount.entries())
    .filter(([, count]) => count >= 3)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return { edges, orphans, hubs };
}

/** File Dependency Graph section for memory tab */
function FileDependencyGraph({ files }: { files: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const memoryFiles = files.filter(f => f.data.category === "memory");
  const { edges, orphans, hubs } = useMemo(() => buildDependencyGraph(memoryFiles), [memoryFiles]);

  if (edges.length === 0 && orphans.length === 0) return null;

  // Group edges by source
  const bySource = new Map<string, string[]>();
  for (const e of edges) {
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source)!.push(e.target);
  }

  return (
    <div className="rounded-lg border border-border/50">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Link2 className="h-3.5 w-3.5" />
        <span>File Relationships</span>
        <span className="text-[10px] opacity-60">{edges.length} links · {orphans.length} orphans</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-border/30 pt-2">
          {/* Hubs */}
          {hubs.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Hubs</p>
              <div className="flex flex-wrap gap-1.5">
                {hubs.map(h => (
                  <Badge key={h.name} variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5 gap-1">
                    <CircleDot className="h-2.5 w-2.5" />{h.name} ({h.count} refs)
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Link map */}
          <div>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">References</p>
            <div className="space-y-1">
              {Array.from(bySource.entries()).map(([source, targets]) => (
                <div key={source} className="flex items-center gap-1.5 text-[11px]">
                  <span className="font-medium text-foreground truncate max-w-[140px]">{source}</span>
                  <span className="text-muted-foreground/40">→</span>
                  <span className="text-muted-foreground truncate">{targets.join(", ")}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Orphans */}
          {orphans.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Orphans (no inbound links)</p>
              <div className="flex flex-wrap gap-1.5">
                {orphans.map(name => (
                  <Badge key={name} variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5">
                    {name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MarkdownFiles() {
  const [, setLocation] = useLocation();
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("name");
  const [showGuide, setShowGuide] = useState(false);
  const [showFixIt, setShowFixIt] = useState(false);
  const [showLearn, setShowLearn] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const { data: files, isLoading } = useMarkdownFiles(category === "all" ? undefined : category);
  const { data: runtimeConfig } = useRuntimeConfig();
  const homeDir = runtimeConfig?.homeDir || null;
  const relativePath = (p: string) => makeRelativePath(p, homeDir);

  // Live change detection — track previous mtimes and highlight recently changed files
  const prevMtimes = useRef<Map<string, string>>(new Map());
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!files) return;
    const prev = prevMtimes.current;
    const changed = new Set<string>();
    for (const f of files) {
      const oldMtime = prev.get(f.id);
      if (oldMtime && f.lastModified && oldMtime !== f.lastModified) {
        changed.add(f.id);
      }
    }
    // Update stored mtimes
    const next = new Map<string, string>();
    for (const f of files) {
      if (f.lastModified) next.set(f.id, f.lastModified);
    }
    prevMtimes.current = next;

    if (changed.size > 0) {
      setRecentlyChanged(changed);
      const timer = setTimeout(() => setRecentlyChanged(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [files]);

  const filtered = (files || []).filter((f) => {
    const q = search.toLowerCase();
    const fm = f.data.frontmatter as Record<string, unknown> | null;
    return f.name.toLowerCase().includes(q) ||
      f.path.toLowerCase().includes(q) ||
      (typeof fm?.name === "string" && fm.name.toLowerCase().includes(q)) ||
      (typeof fm?.description === "string" && fm.description.toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "lines-desc") return (b.data.lineCount || 0) - (a.data.lineCount || 0);
    if (sortKey === "lines-asc") return (a.data.lineCount || 0) - (b.data.lineCount || 0);
    if (sortKey === "modified") return (b.lastModified || "").localeCompare(a.lastModified || "");
    if (sortKey === "size") return (b.data.sizeBytes || 0) - (a.data.sizeBytes || 0);
    return a.name.localeCompare(b.name);
  });

  const grouped = category === "all"
    ? Object.entries(
        sorted.reduce((acc, f) => {
          const cat = f.data.category || "other";
          if (!acc[cat]) acc[cat] = [];
          acc[cat].push(f);
          return acc;
        }, {} as Record<string, typeof filtered>)
      ).sort(([a], [b]) => {
        const order = ["claude-md", "memory", "skill", "readme", "other"];
        return order.indexOf(a) - order.indexOf(b);
      })
    : [["", sorted] as const];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Markdown Files</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} files found</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={sortKey} onChange={e => setSortKey(e.target.value)} className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background text-foreground">
            <option value="name">Name A-Z</option>
            <option value="lines-desc">Most Lines</option>
            <option value="lines-asc">Fewest Lines</option>
            <option value="modified">Recently Modified</option>
            <option value="size">Largest Size</option>
          </select>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search files..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
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

      {/* Type Guide */}
      <div className="rounded-lg border border-border/50">
        <button onClick={() => setShowGuide(!showGuide)} className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>What do these types mean?</span>
          {showGuide ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
        </button>
        {showGuide && (
          <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs border-t border-border/30 pt-2">
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 bg-blue-500/5 flex-shrink-0">CLAUDE.md</Badge>
              <span className="text-muted-foreground">Project instructions Claude reads every session. Defines coding conventions, architecture, and key commands.</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-500/30 text-slate-400 bg-slate-500/5 flex-shrink-0">Index</Badge>
              <span className="text-muted-foreground">MEMORY.md — the index file that links to all memory files. Loaded every session (max 200 lines).</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400 bg-amber-500/5 flex-shrink-0">Feedback</Badge>
              <span className="text-muted-foreground">Corrections or guidance you gave Claude — prevents repeating the same mistakes across sessions.</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400 bg-purple-500/5 flex-shrink-0">User</Badge>
              <span className="text-muted-foreground">Information about you — your role, preferences, and expertise. Helps Claude tailor responses.</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 bg-blue-500/5 flex-shrink-0">Project</Badge>
              <span className="text-muted-foreground">Ongoing work context — goals, deadlines, decisions. Helps Claude understand the bigger picture.</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-400 bg-green-500/5 flex-shrink-0">Reference</Badge>
              <span className="text-muted-foreground">Pointers to external resources — where to find docs, dashboards, or issue trackers.</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-500/30 text-orange-400 bg-orange-500/5 flex-shrink-0">Skill</Badge>
              <span className="text-muted-foreground">Reusable slash commands (e.g., /commit). Defines what Claude does when you invoke the command.</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400 bg-purple-500/5 flex-shrink-0">Memory</Badge>
              <span className="text-muted-foreground">General memory file without a specific type. Falls back when no frontmatter type is set.</span>
            </div>
          </div>
        )}
      </div>

      {/* Memory Health Bar + Learn Guide */}
      {!isLoading && (category === "memory" || category === "all") && (() => {
        const health = analyzeMemoryHealth(files || [], homeDir);
        const colors = { healthy: "border-green-500/30 bg-green-500/5 text-green-400", attention: "border-amber-500/30 bg-amber-500/5 text-amber-400", issues: "border-red-500/30 bg-red-500/5 text-red-400" };
        const icons = { healthy: <CheckCircle className="h-3.5 w-3.5" />, attention: <AlertTriangle className="h-3.5 w-3.5" />, issues: <AlertTriangle className="h-3.5 w-3.5" /> };
        return (
          <>
            <button onClick={() => setShowFixIt(true)} className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs ${colors[health.status]}`}>
              {icons[health.status]}
              <span className="flex-1 text-left">{health.label}</span>
              {health.status === "healthy" ? (
                <span className="text-green-400 font-medium">Healthy</span>
              ) : (
                <span className="flex items-center gap-1"><Wrench className="h-3 w-3" /> Get Organized</span>
              )}
            </button>
            <MemoryLearnGuide show={showLearn} onToggle={() => setShowLearn(!showLearn)} />
            <FixItModal open={showFixIt} onClose={() => setShowFixIt(false)} health={health} />
            <FileDependencyGraph files={files || []} />
          </>
        );
      })()}

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
                  const data = file.data;
                  const display = getCardDisplay(file, homeDir);
                  const lines = data.lineCount || 0;
                  const daysOld = file.lastModified ? Math.floor((Date.now() - new Date(file.lastModified).getTime()) / 86400000) : 0;
                  const isStale = data.category !== "claude-md" && daysOld > 60;
                  return (
                    <Tooltip key={file.id}>
                      <TooltipTrigger asChild>
                        <button
                          className={`w-full text-left rounded-lg border px-4 py-3 hover:bg-accent/30 hover:border-border transition-all duration-150 flex items-center gap-3 group card-hover animate-fade-in-up ${isStale ? "border-amber-500/30 opacity-70" : "border-border/50"} ${recentlyChanged.has(file.id) ? "ring-1 ring-green-500/50 border-green-500/30 bg-green-500/5" : ""}`}
                          style={{ animationDelay: `${i * 20}ms` }}
                          onClick={() => setLocation(`/markdown/${file.id}`)}
                        >
                          <FileText className={`h-4 w-4 flex-shrink-0 ${categoryConfig[data.category]?.color.split(" ").find((c: string) => c.startsWith("text-")) || "text-slate-400"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${display.badgeColor}`}>
                                {display.badge}
                              </Badge>
                              <span className="text-sm font-medium">{display.title}</span>
                              {display.slash && <span className="text-[11px] text-muted-foreground/60 font-mono">{display.slash}</span>}
                              {isStale && <span className="text-[9px] text-amber-400" title={`Last updated ${daysOld} days ago`}><AlertTriangle className="h-3 w-3 inline" /> Stale</span>}
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{display.subtitle}</p>
                          </div>
                          <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-shrink-0">
                            <span className={`font-mono tabular-nums ${lineCountColor(lines)}`}>{lines} lines</span>
                            <span className="font-mono tabular-nums flex items-center gap-1" title={file.lastModified ? new Date(file.lastModified).toLocaleString() : ""}>
                              <Clock className="h-3 w-3" />
                              {file.lastModified ? relativeTime(file.lastModified) : ""}
                            </span>
                            <Edit3
                              className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                              onClick={(e) => { e.stopPropagation(); setEditingFileId(file.id); }}
                            />
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

      <QuickEditDrawer fileId={editingFileId} onClose={() => setEditingFileId(null)} />
    </div>
  );
}
