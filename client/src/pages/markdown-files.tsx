import { useLocation } from "wouter";
import { makeRelativePath } from "@/hooks/use-entities";
import { useMarkdownFiles, useMarkdownContent, useSaveMarkdown, useCreateMarkdownFile, useContentSearch, useContextSummary, useMarkdownMeta, useUpdateMarkdownMeta } from "@/hooks/use-markdown";
import { useRuntimeConfig } from "@/hooks/use-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Search, FileText, Edit3, Clock, AlertTriangle, HelpCircle, ChevronDown, ChevronRight,
  CheckCircle, Clipboard, Check, Wrench, Save, Link2, CircleDot, Plus, Lock, Pin,
  Trash2, Eye, Brain, FileSearch, Layers, Zap, Copy, BookOpen,
} from "lucide-react";
import { relativeTime } from "@/lib/utils";
import MemoryDiagram from "@/components/memory-diagram";

// ── Constants ──────────────────────────────────────────────────────────────────

const memoryTypeColors: Record<string, string> = {
  feedback: "border-amber-500/30 text-amber-400 bg-amber-500/5",
  project: "border-blue-500/30 text-blue-400 bg-blue-500/5",
  reference: "border-green-500/30 text-green-400 bg-green-500/5",
  user: "border-purple-500/30 text-purple-400 bg-purple-500/5",
};

const categories = ["all", "claude-md", "memory", "skill", "readme", "other"] as const;

const categoryConfig: Record<string, { color: string; label: string }> = {
  "claude-md": { color: "border-blue-500/30 text-blue-400 bg-blue-500/5", label: "CLAUDE.md" },
  memory: { color: "border-purple-500/30 text-purple-400 bg-purple-500/5", label: "Memory" },
  skill: { color: "border-orange-500/30 text-orange-400 bg-orange-500/5", label: "Skill" },
  readme: { color: "border-green-500/30 text-green-400 bg-green-500/5", label: "README" },
  other: { color: "border-slate-500/30 text-slate-400 bg-slate-500/5", label: "Other" },
};

const MEMORY_TEMPLATES: Record<string, string> = {
  feedback: `---
name:
description:
type: feedback
---

Rule:

**Why:**

**How to apply:**
`,
  project: `---
name:
description:
type: project
---

## Goals

## Decisions

## Current Status
`,
  reference: `---
name:
description:
type: reference
---

## Access

## Key URLs

## Configuration
`,
  user: `---
name:
description:
type: user
---

## Role & Expertise

## Preferences

## Communication Style
`,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function lineCountColor(n: number): string {
  if (n < 50) return "text-green-400";
  if (n <= 100) return "text-amber-400";
  return "text-red-400";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
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

// ── Memory Health Analysis ──────────────────────────────────────────────────

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
    parts.push(`${n}. These files are missing frontmatter:`);
    for (const f of health.noFrontmatter) parts.push(`   - ${f.path}`);
    parts.push("   Add appropriate frontmatter to each.\n"); n++;
  }
  if (health.memoryMdMissing) { parts.push(`${n}. MEMORY.md index file is missing. Create one.\n`); n++; }
  if (health.memoryMdLines > 150) { parts.push(`${n}. MEMORY.md is ${health.memoryMdLines} lines (limit 200). Trim it.\n`); n++; }
  if (health.overSized.length > 0) {
    parts.push(`${n}. Files over 150 lines:`);
    for (const f of health.overSized) parts.push(`   - ${f.name} (${f.lines} lines)`);
    parts.push("   Review and trim.\n"); n++;
  }
  if (health.staleFiles.length > 0) {
    parts.push(`${n}. Files older than 60 days:`);
    for (const f of health.staleFiles) parts.push(`   - ${f.name} (${f.daysOld} days old)`);
    parts.push("   Check if still relevant.\n"); n++;
  }
  parts.push("After cleanup, verify MEMORY.md is under 100 lines and all files have frontmatter.");
  return parts.join("\n");
}

// ── Fix It Modal ────────────────────────────────────────────────────────────

function FixItModal({ open, onClose, health }: { open: boolean; onClose: () => void; health: MemoryHealth }) {
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => generateFixPrompt(health), [health]);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Wrench className="h-5 w-5 text-amber-400" />Get Organized</DialogTitle></DialogHeader>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {health.issues.length === 0 ? (
            <div className="text-center py-8"><CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-3" /><p className="text-sm font-medium">Well-organized</p></div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium">Issues ({health.issues.length})</p>
                {health.issues.map((issue, i) => (<div key={i} className="flex items-center gap-2 text-xs text-amber-400"><AlertTriangle className="h-3 w-3 flex-shrink-0" />{issue}</div>))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">Paste into Claude Code:</p>
                <div className="relative">
                  <pre className="bg-muted/50 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-auto border border-border/50">{prompt}</pre>
                  <Button size="sm" variant="outline" className="absolute top-2 right-2 gap-1.5" onClick={() => { navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                    {copied ? <Check className="h-3 w-3 text-green-400" /> : <Clipboard className="h-3 w-3" />}{copied ? "Copied" : "Copy"}
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

// ── Memory Learn Guide ──────────────────────────────────────────────────────

function MemoryLearnGuide({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
        <HelpCircle className="h-4 w-4" />How Claude Code Memory Works
        {show ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
      </button>
      {show && (
        <div className="px-4 pb-4 space-y-4 text-sm border-t border-cyan-500/10 pt-3">
          <div className="rounded-lg border border-border/30 bg-muted/20 p-2">
            <p className="text-[10px] text-muted-foreground/60 text-center mb-1">Hover for details</p>
            <MemoryDiagram />
          </div>
          <div className="border-t border-border/30 pt-3"><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-2">Reference</p></div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-1.5">Loaded every session</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li><strong className="text-foreground">CLAUDE.md</strong> — project instructions, loaded in full</li>
              <li><strong className="text-foreground">MEMORY.md</strong> — index file. <span className="text-red-400">Hard limit: 200 lines</span></li>
              <li><strong className="text-foreground">Memory files</strong> linked from MEMORY.md</li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-1.5">Memory types</h4>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-400 flex-shrink-0">Feedback</Badge><span className="text-muted-foreground">Corrections. Prevents repeated mistakes.</span></div>
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400 flex-shrink-0">Project</Badge><span className="text-muted-foreground">Ongoing work context.</span></div>
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-400 flex-shrink-0">Reference</Badge><span className="text-muted-foreground">External resources.</span></div>
              <div className="flex gap-1.5"><Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400 flex-shrink-0">User</Badge><span className="text-muted-foreground">Your role, preferences.</span></div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-2">
              <p className="text-green-400 font-medium text-xs mb-1">Save</p>
              <ul className="text-muted-foreground text-[11px] space-y-0.5"><li>Decisions and why</li><li>Lessons learned</li><li>Feedback / preferences</li><li>External references</li></ul>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2">
              <p className="text-red-400 font-medium text-xs mb-1">Don't save</p>
              <ul className="text-muted-foreground text-[11px] space-y-0.5"><li>File paths / code structure</li><li>Endpoint lists / git history</li><li>Anything already in CLAUDE.md</li></ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick-Edit Drawer ───────────────────────────────────────────────────────

function QuickEditDrawer({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const { data: file, isLoading } = useMarkdownContent(fileId || undefined);
  const saveMutation = useSaveMarkdown();
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [fmName, setFmName] = useState("");
  const [fmDesc, setFmDesc] = useState("");
  const [fmType, setFmType] = useState("");
  const [showFmForm, setShowFmForm] = useState(false);

  useEffect(() => {
    if (file?.content) {
      setContent(file.content);
      setDirty(false);
      const fm = file.data?.frontmatter as Record<string, unknown> | null;
      setFmName(typeof fm?.name === "string" ? fm.name : "");
      setFmDesc(typeof fm?.description === "string" ? fm.description : "");
      setFmType(typeof fm?.type === "string" ? fm.type : "");
      setShowFmForm(file.data?.category === "memory" && !!fm);
    }
  }, [file?.content]);

  const handleSave = useCallback(() => {
    if (!fileId || !dirty) return;
    // If frontmatter form is active, update frontmatter in content
    let finalContent = content;
    if (showFmForm && fmName) {
      const fmBlock = `---\nname: ${fmName}\ndescription: ${fmDesc}\ntype: ${fmType}\n---`;
      // Replace existing frontmatter or prepend
      if (finalContent.startsWith("---")) {
        const endIdx = finalContent.indexOf("---", 3);
        if (endIdx > 0) {
          finalContent = fmBlock + finalContent.slice(endIdx + 3);
        }
      } else {
        finalContent = fmBlock + "\n\n" + finalContent;
      }
    }
    saveMutation.mutate({ id: fileId, content: finalContent }, {
      onSuccess: () => { setDirty(false); setJustSaved(true); setTimeout(() => setJustSaved(false), 2000); },
    });
  }, [fileId, content, dirty, saveMutation, showFmForm, fmName, fmDesc, fmType]);

  useEffect(() => {
    if (!fileId) return;
    const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); } };
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
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${badgeColor}`}>{file?.data?.category || ""}</Badge>
            <SheetTitle className="text-sm">{file?.name || "Loading..."}</SheetTitle>
            {dirty && <Badge variant="secondary" className="text-[10px]">Unsaved</Badge>}
            {justSaved && <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400 gap-1"><Check className="h-2 w-2" /> Saved</Badge>}
          </div>
          <SheetDescription className="text-[11px] font-mono">{file?.path || ""}</SheetDescription>
        </SheetHeader>

        {/* Frontmatter form for memory files */}
        {showFmForm && (
          <div className="px-6 py-2 border-b border-border/30 space-y-1.5">
            <div className="flex gap-2">
              <Input value={fmName} onChange={e => { setFmName(e.target.value); setDirty(true); }} placeholder="Name" className="h-7 text-xs" />
              <select value={fmType} onChange={e => { setFmType(e.target.value); setDirty(true); }} className="text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground h-7">
                <option value="feedback">Feedback</option><option value="project">Project</option><option value="reference">Reference</option><option value="user">User</option>
              </select>
            </div>
            <Input value={fmDesc} onChange={e => { setFmDesc(e.target.value); setDirty(true); }} placeholder="Description" className="h-7 text-xs" />
          </div>
        )}

        <div className="flex-1 min-h-0 px-6 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
          ) : (
            <textarea value={content} onChange={(e) => { setContent(e.target.value); setDirty(true); }}
              className="w-full h-full bg-muted/30 border border-border/50 rounded-lg p-3 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring" spellCheck={false} />
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-3 border-t border-border/50">
          <span className="text-[11px] text-muted-foreground">
            {file?.data?.lineCount || 0} lines · {file?.data?.sizeBytes ? formatSize(file.data.sizeBytes) : ""} · ~{file?.data?.tokenEstimate || 0} tokens
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty || saveMutation.isPending} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />{saveMutation.isPending ? "Saving..." : "Save"}
              <kbd className="text-[9px] font-mono opacity-60 ml-0.5">Ctrl+S</kbd>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Create File Wizard ──────────────────────────────────────────────────────

function CreateFileWizard({ open, onClose, homeDir }: { open: boolean; onClose: () => void; homeDir: string | null }) {
  const createMutation = useCreateMarkdownFile();
  const [fileType, setFileType] = useState<"memory" | "claudemd">("memory");
  const [memType, setMemType] = useState<string>("feedback");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (open) {
      setFileType("memory");
      setMemType("feedback");
      setFileName("");
      setContent(MEMORY_TEMPLATES.feedback);
    }
  }, [open]);

  useEffect(() => {
    if (fileType === "memory" && MEMORY_TEMPLATES[memType]) {
      setContent(MEMORY_TEMPLATES[memType]);
    } else if (fileType === "claudemd") {
      setContent(`# Project Name\n\n## Architecture\n\n## Key Commands\n\n\`\`\`bash\nnpm run dev\nnpm test\n\`\`\`\n\n## File Structure\n\n## Commit Format\n\n\`\`\`\nfeat: description\nfix: description\n\`\`\`\n`);
    }
  }, [fileType, memType]);

  const handleCreate = () => {
    if (!fileName.trim()) return;
    const home = homeDir?.replace(/\\/g, "/") || "";
    const fn = fileName.endsWith(".md") ? fileName : fileName + ".md";
    // Encode home dir to Claude project key: C:/Users/alice → C--Users-alice, /Users/hi → -Users-hi
    const projectKey = home.includes(":")
      ? home.replace(":", "--").replace(/\//g, "-")
      : "-" + home.slice(1).replace(/\//g, "-");
    const filePath = fileType === "memory"
      ? `${home}/.claude/projects/${projectKey}/memory/${fn}`
      : `${home}/${fn}`;
    createMutation.mutate({ filePath, content }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />New File</DialogTitle></DialogHeader>
        <div className="flex-1 overflow-auto space-y-4 py-2">
          <div className="flex gap-2">
            <Button variant={fileType === "memory" ? "default" : "outline"} size="sm" onClick={() => setFileType("memory")} className="gap-1.5"><Brain className="h-3.5 w-3.5" />Memory</Button>
            <Button variant={fileType === "claudemd" ? "default" : "outline"} size="sm" onClick={() => setFileType("claudemd")} className="gap-1.5"><BookOpen className="h-3.5 w-3.5" />CLAUDE.md</Button>
          </div>

          {fileType === "memory" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Memory Type</label>
              <div className="flex gap-1.5">
                {(["feedback", "project", "reference", "user"] as const).map(t => (
                  <Badge key={t} variant="outline"
                    className={`text-xs cursor-pointer transition-colors ${memType === t ? memoryTypeColors[t] : "opacity-50 hover:opacity-80"}`}
                    onClick={() => setMemType(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">File Name</label>
            <Input value={fileName} onChange={e => setFileName(e.target.value)} placeholder={fileType === "memory" ? "e.g. feedback_testing.md" : "CLAUDE.md"} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Content (template pre-filled)</label>
            <textarea value={content} onChange={e => setContent(e.target.value)} rows={12}
              className="w-full bg-muted/30 border border-border/50 rounded-lg p-3 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!fileName.trim() || createMutation.isPending}>{createMutation.isPending ? "Creating..." : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── File Dependency Graph ───────────────────────────────────────────────────

function buildDependencyGraph(files: any[]) {
  const edges: Array<{ source: string; target: string }> = [];
  const inboundCount = new Map<string, number>();
  const fileByName = new Map<string, string>();
  for (const f of files) fileByName.set(f.name.toLowerCase(), f.name);
  for (const f of files) {
    const links = f.data?.links as string[] | undefined;
    if (!links) continue;
    for (const link of links) {
      const targetName = link.split("/").pop()?.toLowerCase() || "";
      const target = fileByName.get(targetName);
      if (target && target !== f.name) {
        edges.push({ source: f.name, target });
        inboundCount.set(target, (inboundCount.get(target) || 0) + 1);
      }
    }
  }
  const orphans = files.filter(f => f.name !== "MEMORY.md" && !inboundCount.has(f.name)).map(f => f.name);
  const hubs = Array.from(inboundCount.entries()).filter(([, c]) => c >= 3).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  // Merge suggestions: files with similar keywords
  const merges: Array<{ files: string[]; reason: string }> = [];
  const memoryOther = files.filter(f => f.name !== "MEMORY.md");
  for (let i = 0; i < memoryOther.length; i++) {
    for (let j = i + 1; j < memoryOther.length; j++) {
      const a = memoryOther[i], b = memoryOther[j];
      const aWords = new Set((a.data.preview || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 4));
      const bWords = new Set((b.data.preview || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 4));
      let overlap = 0;
      Array.from(aWords).forEach(w => { if (bWords.has(w)) overlap++; });
      if (overlap >= 5 && aWords.size > 0 && bWords.size > 0 && overlap / Math.min(aWords.size, bWords.size) > 0.3) {
        merges.push({ files: [a.name, b.name], reason: `${overlap} shared keywords` });
      }
    }
  }
  return { edges, orphans, hubs, merges: merges.slice(0, 3) };
}

function FileDependencyGraph({ files }: { files: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const memoryFiles = files.filter(f => f.data.category === "memory");
  const { edges, orphans, hubs, merges } = useMemo(() => buildDependencyGraph(memoryFiles), [memoryFiles]);
  if (edges.length === 0 && orphans.length === 0) return null;
  const bySource = new Map<string, string[]>();
  for (const e of edges) { if (!bySource.has(e.source)) bySource.set(e.source, []); bySource.get(e.source)!.push(e.target); }
  return (
    <div className="rounded-lg border border-border/50">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Link2 className="h-3.5 w-3.5" /><span>File Relationships</span>
        <span className="text-[10px] opacity-60">{edges.length} links · {orphans.length} orphans</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-border/30 pt-2">
          {hubs.length > 0 && (<div><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Hubs</p><div className="flex flex-wrap gap-1.5">{hubs.map(h => (<Badge key={h.name} variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/5 gap-1"><CircleDot className="h-2.5 w-2.5" />{h.name} ({h.count})</Badge>))}</div></div>)}
          <div><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">References</p><div className="space-y-1">{Array.from(bySource.entries()).map(([source, targets]) => (<div key={source} className="flex items-center gap-1.5 text-[11px]"><span className="font-medium text-foreground truncate max-w-[140px]">{source}</span><span className="text-muted-foreground/40">→</span><span className="text-muted-foreground truncate">{targets.join(", ")}</span></div>))}</div></div>
          {orphans.length > 0 && (<div><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Orphans</p><div className="flex flex-wrap gap-1.5">{orphans.map(name => (<Badge key={name} variant="outline" className="text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5">{name}</Badge>))}</div></div>)}
          {merges.length > 0 && (<div><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Merge Suggestions</p><div className="space-y-1">{merges.map((m, i) => (<div key={i} className="text-[11px] text-muted-foreground"><Layers className="h-3 w-3 inline mr-1 text-cyan-400" />{m.files.join(" + ")} <span className="opacity-60">({m.reason})</span></div>))}</div></div>)}
        </div>
      )}
    </div>
  );
}

// ── Memory Budget Meter ─────────────────────────────────────────────────────

function MemoryBudgetMeter({ files }: { files: any[] }) {
  const memFiles = files.filter(f => f.data.category === "memory");
  const memoryMd = memFiles.find(f => f.name === "MEMORY.md");
  const memoryMdLines = memoryMd?.data.lineCount || 0;
  const totalMemLines = memFiles.reduce((s, f) => s + (f.data.lineCount || 0), 0);
  const totalTokens = memFiles.reduce((s, f) => s + (f.data.tokenEstimate || 0), 0);
  const claudeMdFiles = files.filter(f => f.data.category === "claude-md");
  const totalClaudeTokens = claudeMdFiles.reduce((s, f) => s + (f.data.tokenEstimate || 0), 0);
  const pct = Math.round((memoryMdLines / 200) * 100);
  const color = pct < 50 ? "bg-green-500" : pct < 75 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="rounded-lg border border-border/50 px-4 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5"><Zap className="h-3 w-3" />Context Budget</span>
        <span className="font-mono tabular-nums">{memoryMdLines}/200 lines ({pct}%)</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{totalMemLines} memory lines · ~{totalTokens.toLocaleString()} tokens</span>
        <span>{claudeMdFiles.length} CLAUDE.md · ~{totalClaudeTokens.toLocaleString()} tokens</span>
      </div>
    </div>
  );
}

// ── Content Search Results ──────────────────────────────────────────────────

function ContentSearchResults({ query, onNavigate }: { query: string; onNavigate: (id: string) => void }) {
  const { data: results, isLoading } = useContentSearch(query);
  if (!query || query.length < 2) return null;
  if (isLoading) return <div className="text-xs text-muted-foreground px-4 py-2">Searching content...</div>;
  if (!results || results.length === 0) return <div className="text-xs text-muted-foreground px-4 py-2">No content matches for "{query}"</div>;
  return (
    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-2 space-y-1.5">
      <p className="text-[10px] text-cyan-400 font-medium flex items-center gap-1"><FileSearch className="h-3 w-3" />Content matches ({results.length} files)</p>
      <div className="space-y-1 max-h-40 overflow-auto">
        {results.map(r => (
          <button key={r.fileId} className="w-full text-left text-[11px] hover:bg-accent/30 rounded px-2 py-1 transition-colors" onClick={() => onNavigate(r.fileId)}>
            <span className="font-medium text-foreground">{r.fileName}</span>
            <span className="text-muted-foreground ml-1.5">{r.matches[0]?.text.slice(0, 80)}...</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Context Summary ─────────────────────────────────────────────────────────

function ContextSummaryPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data: ctx } = useContextSummary();
  if (!ctx) return null;
  return (
    <div className="rounded-lg border border-border/50">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Eye className="h-3.5 w-3.5" /><span>What Claude Loads</span>
        <span className="text-[10px] opacity-60">{ctx.totalLines} lines · ~{ctx.totalTokens.toLocaleString()} tokens · {ctx.skillFiles.length} skills</span>
        {expanded ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-border/30 pt-2 text-xs">
          {ctx.claudeMdFiles.length > 0 && (<div><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">CLAUDE.md Files</p>{ctx.claudeMdFiles.map(f => (<div key={f.name} className="flex justify-between text-[11px]"><span className="text-blue-400">{f.name}</span><span className="text-muted-foreground tabular-nums">{f.lines} lines · {f.sections} sections · ~{f.tokens} tok</span></div>))}</div>)}
          {ctx.memoryFiles.length > 0 && (<div><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Memory Files ({ctx.memoryFiles.length})</p>{ctx.memoryFiles.map(f => (<div key={f.name} className="flex justify-between text-[11px]"><span className="text-purple-400">{f.name}</span><span className="text-muted-foreground tabular-nums">{f.type} · {f.lines} lines</span></div>))}</div>)}
          {ctx.skillFiles.length > 0 && (<div><p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Available Skills ({ctx.skillFiles.length})</p><div className="flex flex-wrap gap-1.5">{ctx.skillFiles.map((s, i) => (<Badge key={`${s.slash}-${i}`} variant="outline" className="text-[10px] border-orange-500/30 text-orange-400 bg-orange-500/5 font-mono">{s.slash}</Badge>))}</div></div>)}
          <div className="flex items-center gap-2 pt-1 border-t border-border/30 text-[10px] text-muted-foreground">
            <span>MEMORY.md: {ctx.memoryMdUsage.lines}/{ctx.memoryMdUsage.limit} ({ctx.memoryMdUsage.percentage}%)</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bulk Toolbar ────────────────────────────────────────────────────────────

function BulkToolbar({ selected, onClear, onCopyPaths }: { selected: Set<string>; onClear: () => void; onCopyPaths: () => void }) {
  if (selected.size === 0) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2 rounded-lg border border-blue-500/30 bg-blue-500/5 text-xs">
      <span className="text-blue-400 font-medium">{selected.size} selected</span>
      <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={onCopyPaths}><Copy className="h-3 w-3" />Copy Paths</Button>
      <div className="flex-1" />
      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClear}>Clear</Button>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function MarkdownFiles() {
  const [, setLocation] = useLocation();
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("name");
  const [showGuide, setShowGuide] = useState(false);
  const [showFixIt, setShowFixIt] = useState(false);
  const [showLearn, setShowLearn] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { data: files, isLoading } = useMarkdownFiles(category === "all" ? undefined : category);
  const { data: runtimeConfig } = useRuntimeConfig();
  const { data: fileMeta } = useMarkdownMeta();
  const updateMeta = useUpdateMarkdownMeta();
  const homeDir = runtimeConfig?.homeDir || null;

  // Live change detection
  const prevMtimes = useRef<Map<string, string>>(new Map());
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!files) return;
    const prev = prevMtimes.current;
    const changed = new Set<string>();
    for (const f of files) {
      const oldMtime = prev.get(f.id);
      if (oldMtime && f.lastModified && oldMtime !== f.lastModified) changed.add(f.id);
    }
    const next = new Map<string, string>();
    for (const f of files) { if (f.lastModified) next.set(f.id, f.lastModified); }
    prevMtimes.current = next;
    if (changed.size > 0) {
      setRecentlyChanged(changed);
      const timer = setTimeout(() => setRecentlyChanged(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [files]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "n" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShowCreate(true); }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); document.querySelector<HTMLInputElement>('[placeholder="Search files..."]')?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = (files || []).filter((f) => {
    const q = search.toLowerCase();
    if (!q) return true;
    const fm = f.data.frontmatter as Record<string, unknown> | null;
    return f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q) ||
      (typeof fm?.name === "string" && fm.name.toLowerCase().includes(q)) ||
      (typeof fm?.description === "string" && fm.description.toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    // Pinned files first
    const aMeta = fileMeta?.[a.path];
    const bMeta = fileMeta?.[b.path];
    if (aMeta?.pinned && !bMeta?.pinned) return -1;
    if (!aMeta?.pinned && bMeta?.pinned) return 1;
    if (sortKey === "lines-desc") return (b.data.lineCount || 0) - (a.data.lineCount || 0);
    if (sortKey === "lines-asc") return (a.data.lineCount || 0) - (b.data.lineCount || 0);
    if (sortKey === "modified") return (b.lastModified || "").localeCompare(a.lastModified || "");
    if (sortKey === "size") return (b.data.sizeBytes || 0) - (a.data.sizeBytes || 0);
    return a.name.localeCompare(b.name);
  });

  // For memory tab: group by memory type
  const memoryByType = useMemo(() => {
    if (category !== "memory") return null;
    const groups: Record<string, typeof sorted> = {};
    for (const f of sorted) {
      const fm = f.data.frontmatter as Record<string, unknown> | null;
      const type = typeof fm?.type === "string" ? fm.type : "untyped";
      if (!groups[type]) groups[type] = [];
      groups[type].push(f);
    }
    return groups;
  }, [category, sorted]);

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
    : category === "memory" && memoryByType
      ? Object.entries(memoryByType).sort(([a], [b]) => {
          const order = ["feedback", "project", "reference", "user", "untyped"];
          return order.indexOf(a) - order.indexOf(b);
        })
      : [["", sorted] as const];

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copySelectedPaths = () => {
    const paths = (files || []).filter(f => selected.has(f.id)).map(f => makeRelativePath(f.path, homeDir)).join("\n");
    navigator.clipboard.writeText(paths);
  };

  const renderFileCard = (file: any, i: number) => {
    const data = file.data;
    const display = getCardDisplay(file, homeDir);
    const lines = data.lineCount || 0;
    const daysOld = file.lastModified ? Math.floor((Date.now() - new Date(file.lastModified).getTime()) / 86400000) : 0;
    const isStale = data.category !== "claude-md" && daysOld > 60;
    const meta = fileMeta?.[file.path];
    const isLocked = meta?.locked;
    const isPinned = meta?.pinned;
    const isSelected = selected.has(file.id);

    return (
      <Tooltip key={file.id}>
        <TooltipTrigger asChild>
          <button
            className={`w-full text-left rounded-lg border px-4 py-3 hover:bg-accent/30 hover:border-border transition-all duration-150 flex items-center gap-3 group card-hover animate-fade-in-up ${isStale ? "border-amber-500/30 opacity-70" : "border-border/50"} ${recentlyChanged.has(file.id) ? "ring-1 ring-green-500/50 border-green-500/30 bg-green-500/5" : ""} ${isSelected ? "ring-1 ring-blue-500/50 border-blue-500/30 bg-blue-500/5" : ""}`}
            style={{ animationDelay: `${i * 20}ms` }}
            onClick={(e) => { if (e.shiftKey) { e.preventDefault(); toggleSelect(file.id); } else { setLocation(`/markdown/${file.id}`); } }}
          >
            <FileText className={`h-4 w-4 flex-shrink-0 ${categoryConfig[data.category]?.color.split(" ").find((c: string) => c.startsWith("text-")) || "text-slate-400"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${display.badgeColor}`}>{display.badge}</Badge>
                <span className="text-sm font-medium">{display.title}</span>
                {display.slash && <span className="text-[11px] text-orange-400/60 font-mono">{display.slash}</span>}
                {isPinned && <Pin className="h-3 w-3 text-blue-400" />}
                {isLocked && <Lock className="h-3 w-3 text-amber-400" />}
                {isStale && <span className="text-[9px] text-amber-400"><AlertTriangle className="h-3 w-3 inline" /> Stale</span>}
              </div>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{display.subtitle}</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-shrink-0">
              <span className={`font-mono tabular-nums ${lineCountColor(lines)}`}>{lines}L</span>
              {data.tokenEstimate && <span className="font-mono tabular-nums opacity-60">~{data.tokenEstimate}t</span>}
              <span className="font-mono tabular-nums flex items-center gap-1" title={file.lastModified ? new Date(file.lastModified).toLocaleString() : ""}>
                <Clock className="h-3 w-3" />{file.lastModified ? relativeTime(file.lastModified) : ""}
              </span>
              {/* Pin */}
              <Pin className={`h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${isPinned ? "text-blue-400 fill-blue-400 opacity-100" : "hover:text-blue-400"}`}
                onClick={(e) => { e.stopPropagation(); updateMeta.mutate({ id: file.id, meta: { pinned: !isPinned } }); }} />
              {/* Lock */}
              <Lock className={`h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${isLocked ? "text-amber-400 opacity-100" : "hover:text-amber-400"}`}
                onClick={(e) => { e.stopPropagation(); updateMeta.mutate({ id: file.id, meta: { locked: !isLocked } }); }} />
              {/* Edit */}
              <Edit3 className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                onClick={(e) => { e.stopPropagation(); setEditingFileId(file.id); }} />
            </div>
          </button>
        </TooltipTrigger>
        {data.preview && (
          <TooltipContent side="bottom" className="max-w-sm">
            <pre className="text-[10px] font-mono whitespace-pre-wrap leading-relaxed max-h-32 overflow-hidden">{data.preview.slice(0, 300)}{data.preview.length > 300 ? "..." : ""}</pre>
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Markdown Files</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} files · <kbd className="text-[10px] font-mono opacity-40">n</kbd> new · <kbd className="text-[10px] font-mono opacity-40">/</kbd> search · <kbd className="text-[10px] font-mono opacity-40">shift+click</kbd> select</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)} className="gap-1.5"><Plus className="h-3.5 w-3.5" />New File</Button>
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
          {categories.map((c) => (<TabsTrigger key={c} value={c} className="text-xs">{c === "all" ? "All" : categoryConfig[c]?.label || c}</TabsTrigger>))}
        </TabsList>
      </Tabs>

      {/* Content search results */}
      <ContentSearchResults query={search} onNavigate={(id) => setLocation(`/markdown/${id}`)} />

      {/* Bulk toolbar */}
      <BulkToolbar selected={selected} onClear={() => setSelected(new Set())} onCopyPaths={copySelectedPaths} />

      {/* Type Guide */}
      <div className="rounded-lg border border-border/50">
        <button onClick={() => setShowGuide(!showGuide)} className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <HelpCircle className="h-3.5 w-3.5" /><span>What do these types mean?</span>
          {showGuide ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
        </button>
        {showGuide && (
          <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs border-t border-border/30 pt-2">
            {[
              { badge: "CLAUDE.md", color: "border-blue-500/30 text-blue-400 bg-blue-500/5", desc: "Project instructions Claude reads every session." },
              { badge: "Index", color: "border-slate-500/30 text-slate-400 bg-slate-500/5", desc: "MEMORY.md — links to all memory files (max 200 lines)." },
              { badge: "Feedback", color: "border-amber-500/30 text-amber-400 bg-amber-500/5", desc: "Corrections given to Claude." },
              { badge: "User", color: "border-purple-500/30 text-purple-400 bg-purple-500/5", desc: "Info about you — role, preferences." },
              { badge: "Project", color: "border-blue-500/30 text-blue-400 bg-blue-500/5", desc: "Ongoing work context." },
              { badge: "Reference", color: "border-green-500/30 text-green-400 bg-green-500/5", desc: "External resource pointers." },
              { badge: "Skill", color: "border-orange-500/30 text-orange-400 bg-orange-500/5", desc: "Reusable slash commands." },
              { badge: "Memory", color: "border-purple-500/30 text-purple-400 bg-purple-500/5", desc: "General memory file." },
            ].map(t => (
              <div key={t.badge} className="flex gap-2"><Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${t.color} flex-shrink-0`}>{t.badge}</Badge><span className="text-muted-foreground">{t.desc}</span></div>
            ))}
          </div>
        )}
      </div>

      {/* Memory-specific panels */}
      {!isLoading && (category === "memory" || category === "all") && (() => {
        const health = analyzeMemoryHealth(files || [], homeDir);
        const colors = { healthy: "border-green-500/30 bg-green-500/5 text-green-400", attention: "border-amber-500/30 bg-amber-500/5 text-amber-400", issues: "border-red-500/30 bg-red-500/5 text-red-400" };
        const icons = { healthy: <CheckCircle className="h-3.5 w-3.5" />, attention: <AlertTriangle className="h-3.5 w-3.5" />, issues: <AlertTriangle className="h-3.5 w-3.5" /> };
        return (
          <>
            <button onClick={() => setShowFixIt(true)} className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs ${colors[health.status]}`}>
              {icons[health.status]}
              <span className="flex-1 text-left">{health.label}</span>
              {health.status === "healthy" ? <span className="text-green-400 font-medium">Healthy</span> : <span className="flex items-center gap-1"><Wrench className="h-3 w-3" /> Get Organized</span>}
            </button>
            <MemoryBudgetMeter files={files || []} />
            <MemoryLearnGuide show={showLearn} onToggle={() => setShowLearn(!showLearn)} />
            <FixItModal open={showFixIt} onClose={() => setShowFixIt(false)} health={health} />
            <FileDependencyGraph files={files || []} />
            <ContextSummaryPanel />
          </>
        );
      })()}

      {/* File list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">Loading files...</div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([groupName, groupFiles]) => (
            <div key={groupName || "all"}>
              {groupName && (
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`text-xs ${category === "memory" ? memoryTypeColors[groupName] || categoryConfig.memory.color : categoryConfig[groupName]?.color || ""}`}>
                    {category === "memory" ? groupName.charAt(0).toUpperCase() + groupName.slice(1) : categoryConfig[groupName]?.label || groupName}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{groupFiles.length}</span>
                  <div className="flex-1 border-t border-border/30" />
                </div>
              )}
              <div className="space-y-1.5">
                {groupFiles.map((file, i) => renderFileCard(file, i))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-muted-foreground text-center py-12">No files found</div>}
        </div>
      )}

      <QuickEditDrawer fileId={editingFileId} onClose={() => setEditingFileId(null)} />
      <CreateFileWizard open={showCreate} onClose={() => setShowCreate(false)} homeDir={homeDir} />
    </div>
  );
}
