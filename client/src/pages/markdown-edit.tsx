import { useParams, Link } from "wouter";
import { makeRelativePath } from "@/hooks/use-entities";
import { useMarkdownContent, useMarkdownHistory, useSaveMarkdown, useRestoreMarkdown, useMarkdownFiles, useValidateMarkdown, useBackupContent, useMarkdownMeta, useUpdateMarkdownMeta } from "@/hooks/use-markdown";
import { useRuntimeConfig } from "@/hooks/use-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/skeleton";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArrowLeft, Save, History, RotateCcw, Check, List, Info, ShieldCheck, AlertTriangle, CheckCircle, FileWarning, Lock, Unlock, Zap, FileText, Plus } from "lucide-react";
import MDEditor from "@uiw/react-md-editor";

/** Extract headings from markdown content for TOC */
function extractHeadings(content: string): Array<{ level: number; text: string; id: string }> {
  const headings: Array<{ level: number; text: string; id: string }> = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      headings.push({ level, text, id });
    }
  }
  return headings;
}

/** Extract keywords for overlap detection */
function extractKeywords(content: string): Set<string> {
  const stopwords = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "this", "that", "with", "from", "have", "will", "been", "they", "its", "use", "see", "also", "more", "when", "what", "how", "which", "each", "file", "files", "using", "used", "note", "must", "should"]);
  const words = content.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
  return new Set(words);
}

function detectOverlap(currentContent: string, currentPath: string, allFiles: any[]) {
  const currentHeadings = extractHeadings(currentContent).map(h => h.text.toLowerCase());
  if (currentHeadings.length === 0) return [];
  const overlaps: Array<{ fileName: string; fileId: string; headings: string[] }> = [];
  for (const other of allFiles) {
    if (other.path === currentPath || !other.data.preview) continue;
    const otherKeywords = extractKeywords(other.data.preview);
    const matching = currentHeadings.filter(h => {
      const words = h.split(/\s+/);
      return words.filter(w => w.length > 3 && otherKeywords.has(w)).length >= 2;
    });
    if (matching.length > 0) overlaps.push({ fileName: other.name, fileId: other.id, headings: matching.map(h => h.replace(/\b\w/g, c => c.toUpperCase())) });
  }
  return overlaps.slice(0, 3);
}

/** Simple line-by-line diff */
function computeDiff(oldText: string, newText: string): Array<{ type: "add" | "remove" | "same"; text: string }> {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: Array<{ type: "add" | "remove" | "same"; text: string }> = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  // Simple line-by-line comparison (not LCS, but good enough for quick diff)
  let oi = 0, ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      result.push({ type: "same", text: oldLines[oi] });
      oi++; ni++;
    } else if (ni < newLines.length && (oi >= oldLines.length || !oldLines.slice(oi, oi + 3).includes(newLines[ni]))) {
      result.push({ type: "add", text: newLines[ni] });
      ni++;
    } else {
      result.push({ type: "remove", text: oldLines[oi] });
      oi++;
    }
    if (result.length > maxLen + 100) break; // safety
  }
  return result;
}

const SECTION_TEMPLATES: Record<string, string> = {
  "Architecture": "\n## Architecture\n\nDescribe your system architecture here.\n",
  "Key Commands": "\n## Key Commands\n\n```bash\nnpm run dev\nnpm test\n```\n",
  "File Structure": "\n## File Structure\n\n```\nsrc/\n  components/\n  pages/\n  hooks/\n```\n",
  "Environment Variables": "\n## Environment Variables\n\n| Variable | Purpose | Default |\n|----------|---------|--------|\n| `PORT` | Server port | 3000 |\n",
  "Commit Format": "\n## Commit Format\n\n```\nfeat: description\nfix: description\nchore: description\n```\n",
};

export default function MarkdownEdit() {
  const params = useParams<{ id: string }>();
  const { data: file, isLoading } = useMarkdownContent(params.id);
  const { data: runtimeConfig } = useRuntimeConfig();
  const homeDir = runtimeConfig?.homeDir || null;
  const relativePath = (p: string) => makeRelativePath(p, homeDir);
  const { data: history, refetch: refetchHistory } = useMarkdownHistory(params.id);
  const { data: allFiles } = useMarkdownFiles(undefined);
  const { data: fileMeta } = useMarkdownMeta();
  const updateMeta = useUpdateMarkdownMeta();
  const saveMutation = useSaveMarkdown();
  const restoreMutation = useRestoreMarkdown();
  const [content, setContent] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [diffBackupId, setDiffBackupId] = useState<number | undefined>(undefined);
  const [showTemplates, setShowTemplates] = useState(false);

  // Fetch backup content for diff view
  const { data: diffBackup } = useBackupContent(params.id, diffBackupId);

  useEffect(() => {
    if (file?.content) { setContent(file.content); setDirty(false); }
  }, [file?.content]);

  const handleSave = useCallback(() => {
    if (!params.id || !dirty) return;
    saveMutation.mutate({ id: params.id, content }, {
      onSuccess: () => { setDirty(false); setJustSaved(true); refetchHistory(); setTimeout(() => setJustSaved(false), 2000); },
    });
  }, [params.id, content, dirty, saveMutation, refetchHistory]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const handleRestore = (backupId: number) => {
    if (!params.id) return;
    restoreMutation.mutate({ id: params.id, backupId }, { onSuccess: () => { setShowHistory(false); window.location.reload(); } });
  };

  const headings = useMemo(() => extractHeadings(content), [content]);
  const isClaudeMd = file?.data?.category === "claude-md";
  const hasToc = isClaudeMd && headings.length >= 5;
  const isMemory = file?.data?.category === "memory";
  const overlaps = useMemo(() => {
    if (!isMemory || !allFiles || !content) return [];
    return detectOverlap(content, file?.path || "", allFiles);
  }, [isMemory, allFiles, content, file?.path]);

  const { data: validation, refetch: runValidation, isFetching: isValidating } = useValidateMarkdown(params.id);
  const fm = file?.data?.frontmatter as Record<string, unknown> | null;
  const meta = file ? fileMeta?.[file.path] : undefined;
  const isLocked = meta?.locked;

  // Autosave: debounce 2s after last edit
  const autoSaveRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!dirty || isLocked) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      if (dirty && !isLocked) handleSave();
    }, 2000);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [content, dirty, isLocked, handleSave]);

  const wordCount = useMemo(() => content.split(/\s+/).filter(Boolean).length, [content]);
  const tokenEstimate = useMemo(() => Math.ceil(content.length / 4), [content]);

  // Diff computation
  const diffLines = useMemo(() => {
    if (!diffBackup?.content) return null;
    return computeDiff(diffBackup.content, content);
  }, [diffBackup?.content, content]);

  const insertTemplate = (key: string) => {
    setContent(prev => prev + SECTION_TEMPLATES[key]);
    setDirty(true);
    setShowTemplates(false);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3"><Skeleton className="h-9 w-9 rounded-md" /><div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-64" /></div></div>
        <Skeleton className="h-[calc(100vh-200px)] w-full rounded-lg" />
      </div>
    );
  }

  if (!file) return <div className="p-6 text-muted-foreground">File not found</div>;

  return (
    <div className="p-6 space-y-4 h-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/markdown"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-lg font-bold">{file.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">{relativePath(file.path)}</p>
          </div>
          <Badge variant="outline" className="text-xs">{file.data.category}</Badge>
          {fm && isMemory && typeof fm.type === "string" && <Badge variant="outline" className="text-xs capitalize">{fm.type}</Badge>}
          {isLocked && <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400 gap-1"><Lock className="h-2.5 w-2.5" />Locked</Badge>}
          {dirty && <Badge variant="secondary" className="text-xs">Unsaved</Badge>}
          {justSaved && <Badge variant="outline" className="text-xs border-green-500/30 text-green-400 gap-1"><Check className="h-2.5 w-2.5" /> Saved</Badge>}
        </div>
        <div className="flex gap-2">
          {/* Lock toggle */}
          <Button variant="outline" size="sm" onClick={() => updateMeta.mutate({ id: file.id, meta: { locked: !isLocked } })} title={isLocked ? "Unlock file" : "Lock file"}>
            {isLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          </Button>
          {/* Template insertion */}
          {isClaudeMd && (
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setShowTemplates(!showTemplates)} className="gap-1.5"><Plus className="h-4 w-4" />Insert</Button>
              {showTemplates && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-lg shadow-lg py-1 w-48">
                  {Object.keys(SECTION_TEMPLATES).map(key => (
                    <button key={key} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors" onClick={() => insertTemplate(key)}>{key}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {isClaudeMd && (
            <Button variant="outline" size="sm" onClick={() => runValidation()} disabled={isValidating} className="gap-1.5">
              <ShieldCheck className="h-4 w-4" />{isValidating ? "..." : "Validate"}
            </Button>
          )}
          {hasToc && <Button variant="outline" size="sm" onClick={() => setShowToc(!showToc)}><List className="h-4 w-4" />TOC</Button>}
          <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
            <History className="h-4 w-4" />History {history && history.length > 0 ? `(${history.length})` : ""}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saveMutation.isPending || isLocked} className="gap-1.5">
            <Save className="h-4 w-4" />{saveMutation.isPending ? "Saving..." : "Save"}
            <kbd className="hidden sm:inline text-[10px] font-mono opacity-60 ml-1">Ctrl+S</kbd>
          </Button>
        </div>
      </div>

      {/* Lock warning */}
      {isLocked && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-amber-400">This file is locked. Unlock it before editing.</span>
        </div>
      )}

      {/* Frontmatter header for memory files */}
      {fm && isMemory && (
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-2 text-xs space-y-0.5">
          {typeof fm.name === "string" && <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{fm.name}</span></div>}
          {typeof fm.description === "string" && <div><span className="text-muted-foreground">Description:</span> {fm.description}</div>}
          {typeof fm.type === "string" && <div><span className="text-muted-foreground">Type:</span> <span className="capitalize">{fm.type}</span></div>}
        </div>
      )}

      {/* Skill frontmatter */}
      {fm && file.data.category === "skill" && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-4 py-2 text-xs space-y-0.5">
          {typeof fm.description === "string" && <div><span className="text-muted-foreground">Description:</span> {fm.description}</div>}
          {typeof fm["allowed-tools"] === "string" && <div><span className="text-muted-foreground">Tools:</span> {fm["allowed-tools"]}</div>}
          {typeof fm.model === "string" && <div><span className="text-muted-foreground">Model:</span> {fm.model}</div>}
        </div>
      )}

      {/* Overlap detection */}
      {overlaps.length > 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2 text-xs flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div><span className="text-blue-400">Potential overlap: </span>
            {overlaps.map((o, i) => (<span key={o.fileId}>{i > 0 && ", "}<Link href={`/markdown/${o.fileId}`}><span className="text-blue-400 underline cursor-pointer">{o.fileName}</span></Link>{o.headings.length > 0 && <span className="text-muted-foreground"> ({o.headings.slice(0, 2).join(", ")})</span>}</span>))}
          </div>
        </div>
      )}

      {/* Validation results */}
      {isClaudeMd && validation && (
        <div className={`rounded-lg border px-4 py-2.5 text-xs space-y-2 ${validation.issues.length === 0 ? "border-green-500/20 bg-green-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
          <div className="flex items-center gap-2">
            {validation.issues.length === 0 ? (
              <><CheckCircle className="h-3.5 w-3.5 text-green-400" /><span className="text-green-400 font-medium">All references valid</span><span className="text-muted-foreground">({validation.validPaths.length} paths, {validation.ports.length} ports)</span></>
            ) : (
              <><FileWarning className="h-3.5 w-3.5 text-amber-400" /><span className="text-amber-400 font-medium">{validation.issues.length} issue{validation.issues.length !== 1 ? "s" : ""}</span></>
            )}
          </div>
          {validation.issues.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-auto">
              {validation.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px]">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5 text-amber-400" />
                  <span className="text-muted-foreground">{issue.line && <span className="text-foreground font-mono">L{issue.line}: </span>}{issue.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Diff view */}
      {diffLines && (
        <div className="rounded-lg border border-border/50 max-h-60 overflow-auto">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/30">
            <span className="text-[10px] text-muted-foreground">Diff: backup vs current</span>
            <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => setDiffBackupId(undefined)}>Close</Button>
          </div>
          <pre className="p-3 text-[11px] font-mono leading-relaxed">
            {diffLines.map((line, i) => (
              <div key={i} className={line.type === "add" ? "text-green-400 bg-green-500/5" : line.type === "remove" ? "text-red-400 bg-red-500/5" : "text-muted-foreground"}>
                {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} {line.text}
              </div>
            ))}
          </pre>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-1">
        <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{content.split("\n").length} lines</span>
        <span>{wordCount} words</span>
        <span className="flex items-center gap-1"><Zap className="h-3 w-3" />~{tokenEstimate.toLocaleString()} tokens</span>
        <span>{formatSize(new Blob([content]).size)}</span>
      </div>

      {/* Editor + sidebars */}
      <div className="flex flex-1 gap-4 min-h-0">
        {showToc && hasToc && (
          <Card className="w-64 flex-shrink-0 overflow-auto">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Table of Contents</CardTitle></CardHeader>
            <CardContent className="space-y-0.5">
              {headings.map((h, i) => (
                <button key={i} className="block w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors truncate" style={{ paddingLeft: `${(h.level - 2) * 12 + 4}px` }}
                  onClick={() => { const el = document.querySelector(`[data-color-mode] .wmde-markdown #${h.id}, [data-color-mode] .wmde-markdown [id="${h.id}"]`); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  {h.level > 2 && <span className="text-muted-foreground/30 mr-1">└</span>}{h.text}
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="flex-1" data-color-mode="dark">
          <MDEditor value={content} onChange={(val) => { if (!isLocked) { setContent(val || ""); setDirty(true); } }}
            height="100%" preview="live" />
        </div>

        {showHistory && (
          <Card className="w-72 flex-shrink-0 overflow-auto">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Version History</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(!history || history.length === 0) && (
                <div className="text-center py-6"><History className="h-6 w-6 mx-auto mb-2 opacity-20 text-muted-foreground" /><p className="text-xs text-muted-foreground">No history yet</p></div>
              )}
              {history?.map((backup) => (
                <div key={backup.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div>
                    <p className="text-xs font-mono">{new Date(backup.createdAt).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{backup.reason} - {(backup.sizeBytes / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDiffBackupId(backup.id)} title="Compare with current">
                      <FileText className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRestore(backup.id)} title="Restore">
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}
