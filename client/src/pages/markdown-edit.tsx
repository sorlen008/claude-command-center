import { useParams, Link } from "wouter";
import { useMarkdownContent, useMarkdownHistory, useSaveMarkdown, useRestoreMarkdown, useRuntimeConfig, makeRelativePath } from "@/hooks/use-entities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/skeleton";
import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Save, History, RotateCcw, Check } from "lucide-react";
import MDEditor from "@uiw/react-md-editor";

export default function MarkdownEdit() {
  const params = useParams<{ id: string }>();
  const { data: file, isLoading } = useMarkdownContent(params.id);
  const { data: runtimeConfig } = useRuntimeConfig();
  const homeDir = runtimeConfig?.homeDir || null;
  const relativePath = (p: string) => makeRelativePath(p, homeDir);
  const { data: history, refetch: refetchHistory } = useMarkdownHistory(params.id);
  const saveMutation = useSaveMarkdown();
  const restoreMutation = useRestoreMarkdown();
  const [content, setContent] = useState("");
  const [showHistory, setShowHistory] = useState(false);
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

  // Ctrl+S keyboard shortcut
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
          <Badge variant="outline" className="text-xs">{(file.data as any).category}</Badge>
          {dirty && <Badge variant="secondary" className="text-xs">Unsaved</Badge>}
          {justSaved && (
            <Badge variant="outline" className="text-xs border-green-500/30 text-green-400 gap-1">
              <Check className="h-2.5 w-2.5" /> Saved
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
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

      <div className="flex flex-1 gap-4 min-h-0">
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
