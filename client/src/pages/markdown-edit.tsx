import { useParams, Link } from "wouter";
import { makeRelativePath } from "@/hooks/use-entities";
import { useMarkdownContent, useMarkdownHistory, useSaveMarkdown, useRestoreMarkdown, useMarkdownFiles, useValidateMarkdown } from "@/hooks/use-markdown";
import { useRuntimeConfig } from "@/hooks/use-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/skeleton";
import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, Save, History, RotateCcw, Check, List, Info, ShieldCheck, AlertTriangle, CheckCircle, FileWarning } from "lucide-react";
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

/** Extract significant keywords from content for overlap detection */
function extractKeywords(content: string): Set<string> {
  const stopwords = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "this", "that", "with", "from", "have", "will", "been", "they", "its", "use", "see", "also", "more", "when", "what", "how", "which", "each", "file", "files", "using", "used", "note", "must", "should"]);
  const words = content.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));
  return new Set(words);
}

/** Detect heading-level overlap between current file and other files */
function detectOverlap(currentContent: string, currentPath: string, allFiles: any[]): Array<{ fileName: string; fileId: string; headings: string[] }> {
  const currentHeadings = extractHeadings(currentContent).map(h => h.text.toLowerCase());
  if (currentHeadings.length === 0) return [];

  const overlaps: Array<{ fileName: string; fileId: string; headings: string[] }> = [];

  for (const other of allFiles) {
    if (other.path === currentPath) continue;
    if (!other.data.preview) continue;

    // Check heading overlap using preview (first 300 chars) + keywords
    const otherKeywords = extractKeywords(other.data.preview);
    const matchingHeadings = currentHeadings.filter(h => {
      const words = h.split(/\s+/);
      return words.filter(w => w.length > 3 && otherKeywords.has(w)).length >= 2;
    });

    if (matchingHeadings.length > 0) {
      overlaps.push({
        fileName: other.name,
        fileId: other.id,
        headings: matchingHeadings.map(h => h.replace(/\b\w/g, c => c.toUpperCase())),
      });
    }
  }

  return overlaps.slice(0, 3);
}

export default function MarkdownEdit() {
  const params = useParams<{ id: string }>();
  const { data: file, isLoading } = useMarkdownContent(params.id);
  const { data: runtimeConfig } = useRuntimeConfig();
  const homeDir = runtimeConfig?.homeDir || null;
  const relativePath = (p: string) => makeRelativePath(p, homeDir);
  const { data: history, refetch: refetchHistory } = useMarkdownHistory(params.id);
  const { data: allFiles } = useMarkdownFiles(undefined);
  const saveMutation = useSaveMarkdown();
  const restoreMutation = useRestoreMarkdown();
  const [content, setContent] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (file?.content) {
      setContent(file.content);
      setDirty(false);
    }
  }, [file?.content]);

  const handleSave = useCallback(() => {
    if (!params.id || !dirty) return;
    saveMutation.mutate(
      { id: params.id, content },
      {
        onSuccess: () => {
          setDirty(false);
          setJustSaved(true);
          refetchHistory();
          setTimeout(() => setJustSaved(false), 2000);
        },
      }
    );
  }, [params.id, content, dirty, saveMutation, refetchHistory]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const handleRestore = (backupId: number) => {
    if (!params.id) return;
    restoreMutation.mutate(
      { id: params.id, backupId },
      {
        onSuccess: () => {
          setShowHistory(false);
          window.location.reload();
        },
      }
    );
  };

  // TOC for CLAUDE.md files
  const headings = useMemo(() => extractHeadings(content), [content]);
  const isClaudeMd = file?.data?.category === "claude-md";
  const hasToc = isClaudeMd && headings.length >= 5;

  // Overlap detection for memory files
  const isMemory = file?.data?.category === "memory";
  const overlaps = useMemo(() => {
    if (!isMemory || !allFiles || !content) return [];
    return detectOverlap(content, file?.path || "", allFiles);
  }, [isMemory, allFiles, content, file?.path]);

  // CLAUDE.md validation
  const { data: validation, refetch: runValidation, isFetching: isValidating } = useValidateMarkdown(params.id);

  // Frontmatter display
  const fm = file?.data?.frontmatter as Record<string, unknown> | null;

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <Skeleton className="h-[calc(100vh-200px)] w-full rounded-lg" />
      </div>
    );
  }

  if (!file) return <div className="p-6 text-muted-foreground">File not found</div>;

  return (
    <div className="p-6 space-y-4 h-screen flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/markdown">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold">{file.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">{relativePath(file.path)}</p>
          </div>
          <Badge variant="outline" className="text-xs">{file.data.category}</Badge>
          {fm && isMemory && typeof fm.type === "string" && (
            <Badge variant="outline" className="text-xs capitalize">{fm.type}</Badge>
          )}
          {dirty && <Badge variant="secondary" className="text-xs">Unsaved</Badge>}
          {justSaved && (
            <Badge variant="outline" className="text-xs border-green-500/30 text-green-400 gap-1">
              <Check className="h-2.5 w-2.5" /> Saved
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {isClaudeMd && (
            <Button variant="outline" size="sm" onClick={() => runValidation()} disabled={isValidating} className="gap-1.5">
              <ShieldCheck className="h-4 w-4" />
              {isValidating ? "Validating..." : "Validate"}
            </Button>
          )}
          {hasToc && (
            <Button variant="outline" size="sm" onClick={() => setShowToc(!showToc)}>
              <List className="h-4 w-4" />
              TOC
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowHistory(!showHistory)}>
            <History className="h-4 w-4" />
            History {history && history.length > 0 ? `(${history.length})` : ""}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || saveMutation.isPending} className="gap-1.5">
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save"}
            <kbd className="hidden sm:inline text-[10px] font-mono opacity-60 ml-1">Ctrl+S</kbd>
          </Button>
        </div>
      </div>

      {/* Frontmatter header for memory files */}
      {fm && isMemory && (
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-2 text-xs space-y-0.5">
          {typeof fm.name === "string" && <div><span className="text-muted-foreground">Name:</span> <span className="font-medium">{fm.name}</span></div>}
          {typeof fm.description === "string" && <div><span className="text-muted-foreground">Description:</span> {fm.description}</div>}
          {typeof fm.type === "string" && <div><span className="text-muted-foreground">Type:</span> <span className="capitalize">{fm.type}</span></div>}
        </div>
      )}

      {/* Frontmatter header for skill files */}
      {fm && file.data.category === "skill" && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-4 py-2 text-xs space-y-0.5">
          {typeof fm.description === "string" && <div><span className="text-muted-foreground">Description:</span> {fm.description}</div>}
          {typeof fm["allowed-tools"] === "string" && <div><span className="text-muted-foreground">Tools:</span> {fm["allowed-tools"]}</div>}
          {typeof fm.model === "string" && <div><span className="text-muted-foreground">Model:</span> {fm.model}</div>}
        </div>
      )}

      {/* Overlap detection banner for memory files */}
      {overlaps.length > 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2 text-xs flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="text-blue-400">Potential overlap with: </span>
            {overlaps.map((o, i) => (
              <span key={o.fileId}>
                {i > 0 && ", "}
                <Link href={`/markdown/${o.fileId}`}>
                  <span className="text-blue-400 underline cursor-pointer">{o.fileName}</span>
                </Link>
                {o.headings.length > 0 && (
                  <span className="text-muted-foreground"> ({o.headings.slice(0, 2).join(", ")})</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* CLAUDE.md Validation Results */}
      {isClaudeMd && validation && (
        <div className={`rounded-lg border px-4 py-2.5 text-xs space-y-2 ${validation.issues.length === 0 ? "border-green-500/20 bg-green-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
          <div className="flex items-center gap-2">
            {validation.issues.length === 0 ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                <span className="text-green-400 font-medium">All references valid</span>
                <span className="text-muted-foreground">({validation.validPaths.length} paths, {validation.ports.length} ports checked)</span>
              </>
            ) : (
              <>
                <FileWarning className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-amber-400 font-medium">{validation.issues.length} issue{validation.issues.length !== 1 ? "s" : ""} found</span>
              </>
            )}
          </div>
          {validation.issues.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-auto">
              {validation.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px]">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5 text-amber-400" />
                  <span className="text-muted-foreground">
                    {issue.line && <span className="text-foreground font-mono">L{issue.line}: </span>}
                    {issue.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 gap-4 min-h-0">
        {/* TOC sidebar for CLAUDE.md */}
        {showToc && hasToc && (
          <Card className="w-64 flex-shrink-0 overflow-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Table of Contents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {headings.map((h, i) => (
                <button
                  key={i}
                  className="block w-full text-left text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
                  style={{ paddingLeft: `${(h.level - 2) * 12 + 4}px` }}
                  onClick={() => {
                    // Scroll to heading in the preview pane
                    const el = document.querySelector(`[data-color-mode] .wmde-markdown #${h.id}, [data-color-mode] .wmde-markdown [id="${h.id}"]`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  {h.level > 2 && <span className="text-muted-foreground/30 mr-1">└</span>}
                  {h.text}
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="flex-1" data-color-mode="dark">
          <MDEditor
            value={content}
            onChange={(val) => {
              setContent(val || "");
              setDirty(true);
            }}
            height="100%"
            preview="live"
          />
        </div>

        {showHistory && (
          <Card className="w-72 flex-shrink-0 overflow-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Version History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(!history || history.length === 0) && (
                <div className="text-center py-6">
                  <History className="h-6 w-6 mx-auto mb-2 opacity-20 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">No history yet</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Backups are created on each save</p>
                </div>
              )}
              {history?.map((backup) => (
                <div key={backup.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div>
                    <p className="text-xs font-mono">{new Date(backup.createdAt).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {backup.reason} - {(backup.sizeBytes / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleRestore(backup.id)}
                    title="Restore this version"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
