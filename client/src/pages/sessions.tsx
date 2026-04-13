import { useState, useEffect } from "react";
import { useSessions, useSessionDetail, useDeleteSession, useBulkDeleteSessions, useDeleteAllSessions, useUndoDeleteSessions, useDeepSearch, useSummarizeSession, useSummarizeBatch, useSessionSummary, useCostAnalytics, useFileHeatmap, useHealthAnalytics, useStaleAnalytics, useSessionCost, useSessionCommits, useContextLoader, useProjectDashboards, useSessionDiffs, usePromptTemplates, useCreatePrompt, useDeletePrompt, useWeeklyDigest, useWorkflowConfig, useUpdateWorkflow, useRunWorkflows, useTogglePin, useSaveNote, useFileTimeline, useNLQuery, useContinuations, useDecisions, useExtractDecisions, useBashKnowledge, useBashSearch, useNerveCenter, useDelegate } from "@/hooks/use-sessions";
import { useAppSettings } from "@/hooks/use-settings";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Search, Terminal, Trash2, Copy, Check, ChevronDown, ChevronRight,
  HardDrive, MessageSquare, Clock, Hash, X, AlertTriangle, Undo2, FolderOpen,
  Sparkles, Loader2, Zap, DollarSign, FileText, Activity, Archive,
  GitCommit, Clipboard, BarChart3, FolderKanban, Calendar, Settings,
  Plus, Play, BookOpen, Pin, StickyNote, MessageCircleQuestion,
  Server, Brain, TerminalSquare, Phone, Send, ArrowRight, Lightbulb, Download,
} from "lucide-react";
import type { SessionData, DeepSearchMatch } from "@shared/types";
import { formatBytes, relativeTime as _relativeTime, formatDuration } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  try {
    const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i}>{part}</mark>
          ) : (
            part
          )
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "-";
  return _relativeTime(dateStr);
}

export default function Sessions() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("lastTs:desc");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: "single" | "bulk" | "all"; id?: string } | null>(null);
  const [searchMode, setSearchMode] = useState<"titles" | "deep" | "uuid">("deep");
  const [activeTab, setActiveTab] = useState<"sessions" | "analytics">("sessions");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Read project filter and deep-link session ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const [projectFilter, setProjectFilter] = useState(urlParams.get("project") || "");
  // If ?session=<id> is in the URL, expand that session on mount and scroll
  // it into view. Used by Live View to navigate to a specific session.
  useEffect(() => {
    const sid = urlParams.get("session");
    if (sid) {
      setExpanded(sid);
      // Strip the param so refreshes don't re-expand it
      const next = new URLSearchParams(window.location.search);
      next.delete("session");
      const qs = next.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      // Scroll the expanded card into view after the next paint
      setTimeout(() => {
        const el = document.querySelector(`[data-session-id="${sid}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sort, order] = sortKey.split(":") as [string, string];
  const { data, isLoading } = useSessions({ q: search || undefined, sort, order, hideEmpty, activeOnly, project: projectFilter || undefined, page, limit: PAGE_SIZE });
  const expandedDetail = useSessionDetail(expanded || undefined);
  const deleteSession = useDeleteSession();
  const bulkDelete = useBulkDeleteSessions();
  const deleteAll = useDeleteAllSessions();
  const undoDelete = useUndoDeleteSessions();
  const deepSearchQuery = useDeepSearch({ q: searchMode === "deep" ? search : undefined, project: projectFilter || undefined });
  const summarizeSession = useSummarizeSession();
  const summarizeBatch = useSummarizeBatch();
  const togglePin = useTogglePin();
  const saveNote = useSaveNote();

  const sessions = data?.sessions || [];
  const stats = data?.stats;

  const uuidResults = searchMode === "uuid" && search.length >= 3
    ? sessions.filter(s => s.id.toLowerCase().includes(search.toLowerCase()))
    : null;

  const handleCopyResume = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`claude --resume ${id}`);
    setCopiedId("resume:" + id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "single" && deleteConfirm.id) {
      deleteSession.mutate(deleteConfirm.id);
      selected.delete(deleteConfirm.id);
      setSelected(new Set(selected));
      if (expanded === deleteConfirm.id) setExpanded(null);
    } else if (deleteConfirm.type === "bulk") {
      bulkDelete.mutate(Array.from(selected));
      if (expanded && selected.has(expanded)) setExpanded(null);
      setSelected(new Set());
    } else if (deleteConfirm.type === "all") {
      deleteAll.mutate();
      setSelected(new Set());
      setExpanded(null);
    }
    setDeleteConfirm(null);
  };

  const canUndo = (data as any)?.canUndo === true;

  const handleOpenFolder = async (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const folder = filePath.replace(/\/[^/]+$/, "");
    try { await apiRequest("POST", "/api/actions/open-folder", { path: folder }); } catch {}
  };

  const statCards = [
    { label: "Total", value: stats?.totalCount ?? 0, icon: MessageSquare, color: "text-blue-400" },
    { label: "Storage", value: formatBytes(stats?.totalSize ?? 0), icon: HardDrive, color: "text-purple-400" },
    { label: "Active", value: stats?.activeCount ?? 0, icon: Clock, color: "text-green-400" },
    { label: "Empty", value: stats?.emptyCount ?? 0, icon: Hash, color: "text-amber-400" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sessions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}{stats ? `, ${formatBytes(stats.totalSize)}` : ""} — Browse and manage Claude sessions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirm({ type: "all" })}
            disabled={sessions.length === 0}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete All
          </Button>
          <button
            onClick={() => setHideEmpty(!hideEmpty)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              hideEmpty ? "border-blue-500/30 bg-blue-500/10 text-blue-400" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Hide Empty
          </button>
          <button
            onClick={() => setActiveOnly(!activeOnly)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              activeOnly ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Active Only
          </button>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-background text-foreground"
          >
            <option value="lastTs:desc">Newest First</option>
            <option value="lastTs:asc">Oldest First</option>
            <option value="slug:asc">Name A-Z</option>
            <option value="slug:desc">Name Z-A</option>
            <option value="sizeBytes:desc">Largest First</option>
            <option value="sizeBytes:asc">Smallest First</option>
            <option value="messageCount:desc">Most Messages</option>
            <option value="messageCount:asc">Fewest Messages</option>
          </select>
          <div className="relative">
            <select
              className="appearance-none text-xs bg-background border rounded-md pl-7 pr-8 py-[7px] outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer text-foreground hover:border-purple-500/50 transition-colors"
              disabled={summarizeBatch.isPending}
              value=""
              onChange={(e) => {
                const mode = e.target.value as "all" | "top10" | "pinned";
                if (mode) summarizeBatch.mutate(mode);
                e.target.value = "";
              }}
            >
              <option value="" disabled>{summarizeBatch.isPending ? "Summarizing..." : "Summarize"}</option>
              <option value="all">All (next 10 unsummarized)</option>
              <option value="top10">Top 10 most used</option>
              <option value="pinned">Pinned sessions only</option>
            </select>
            <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
              {summarizeBatch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" /> : <Sparkles className="h-3.5 w-3.5 text-purple-400" />}
            </div>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
          <div className="flex items-center gap-0">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder={searchMode === "uuid" ? "Paste or type UUID..." : searchMode === "deep" ? "Deep search content..." : "Search sessions..."} value={search} onChange={e => setSearch(e.target.value)} className="pl-9 rounded-r-none" />
            </div>
            <div className="flex border border-l-0 border-border rounded-r-md overflow-hidden">
              <button
                onClick={() => setSearchMode("titles")}
                className={`text-[11px] px-2.5 py-[7px] transition-colors ${
                  searchMode === "titles" ? "bg-blue-500/10 text-blue-400 font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                Titles
              </button>
              <button
                onClick={() => setSearchMode("deep")}
                className={`text-[11px] px-2.5 py-[7px] transition-colors ${
                  searchMode === "deep" ? "bg-purple-500/10 text-purple-400 font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Zap className="h-3 w-3 inline mr-0.5" />Deep
              </button>
              <button
                onClick={() => setSearchMode("uuid")}
                className={`text-[11px] px-2.5 py-[7px] transition-colors ${
                  searchMode === "uuid" ? "bg-cyan-500/10 text-cyan-400 font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Hash className="h-3 w-3 inline mr-0.5" />UUID
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((s, i) => (
          <div key={s.label} className="rounded-xl border bg-card p-4 animate-fade-in-up gradient-border" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">{s.label}</p>
                <p className="text-2xl font-bold font-mono mt-1">{s.value}</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-2.5">
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("sessions")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === "sessions" ? "border-blue-500 text-blue-400" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5 inline mr-1.5" />Sessions
        </button>
        <button
          onClick={() => setActiveTab("analytics")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === "analytics" ? "border-purple-500 text-purple-400" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5 inline mr-1.5" />Analytics
        </button>
      </div>

      {activeTab === "analytics" ? (
        <AnalyticsPanel />
      ) : (
      <>
      {/* Undo bar */}
      {canUndo && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <Undo2 className="h-4 w-4 text-amber-400 flex-shrink-0" />
          <span className="text-sm text-muted-foreground">Sessions were deleted.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => undoDelete.mutate()}
            disabled={undoDelete.isPending}
            className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
          >
            <Undo2 className="h-3.5 w-3.5" /> {undoDelete.isPending ? "Restoring..." : "Undo"}
          </Button>
        </div>
      )}

      {/* Project filter banner */}
      {projectFilter && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
          <FolderOpen className="h-4 w-4 text-cyan-400 flex-shrink-0" />
          <span className="text-sm text-muted-foreground">
            Filtered by project: <span className="font-medium text-foreground">{projectFilter}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setProjectFilter("");
              window.history.replaceState({}, "", window.location.pathname);
            }}
            className="gap-1.5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-blue-500/30 bg-blue-500/5">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteConfirm({ type: "bulk" })}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            <X className="h-3.5 w-3.5 mr-1" /> Clear
          </Button>
        </div>
      )}

      {/* Session list / UUID search / Deep search results */}
      {searchMode === "uuid" && search.length >= 3 ? (
        uuidResults && uuidResults.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <Hash className="h-3.5 w-3.5 text-cyan-400" />
              {uuidResults.length} session{uuidResults.length !== 1 ? "s" : ""} matching UUID
            </div>
            {uuidResults.map((s, i) => (
              <SessionCard
                key={s.id}
                session={s}
                index={i}
                isSelected={selected.has(s.id)}
                isExpanded={expanded === s.id}
                copiedId={copiedId}
                detail={expanded === s.id ? expandedDetail.data : undefined}
                onToggleSelect={handleToggleSelect}
                onToggleExpand={(id) => setExpanded(expanded === id ? null : id)}
                onCopyId={handleCopyId}
                onCopyResume={handleCopyResume}
                onOpenFolder={handleOpenFolder}
                onDelete={(id, e) => { e.stopPropagation(); setDeleteConfirm({ type: "single", id }); }}
                onSummarize={(id) => summarizeSession.mutate(id)}
                isSummarizing={summarizeSession.isPending}
                onTogglePin={(id) => togglePin.mutate(id)}
                onSaveNote={(id, text) => saveNote.mutate({ id, text })}
                searchQuery={search}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={Hash} title="No sessions matching UUID" description="Try a partial or full UUID" />
        )
      ) : searchMode === "deep" && search.length >= 2 ? (
        // Deep search mode
        deepSearchQuery.isLoading ? (
          <div className="flex items-center gap-3 justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Searching through session content...</span>
          </div>
        ) : deepSearchQuery.data && deepSearchQuery.data.results.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              {deepSearchQuery.data.totalMatches} matches across {deepSearchQuery.data.results.length} sessions
              ({deepSearchQuery.data.searchedSessions} searched in {deepSearchQuery.data.durationMs}ms)
            </div>
            {deepSearchQuery.data.results.map((match, i) => (
              <DeepSearchCard
                key={match.sessionId}
                match={match}
                index={i}
                searchQuery={search}
                isExpanded={expanded === match.sessionId}
                onToggleExpand={(id) => setExpanded(expanded === id ? null : id)}
                onCopyResume={handleCopyResume}
                copiedId={copiedId}
                onSummarize={(id) => summarizeSession.mutate(id)}
                isSummarizing={summarizeSession.isPending}
              />
            ))}
          </div>
        ) : search.length >= 2 ? (
          <EmptyState icon={Search} title="No matches found" description="Try different search terms or switch to Titles mode" />
        ) : null
      ) : isLoading ? (
        <ListSkeleton rows={6} />
      ) : sessions.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No sessions found" description="Try adjusting your search or filters" />
      ) : (
        <div className="space-y-2">
          {/* Pinned sessions first */}
          {sessions.filter(s => s.isPinned).length > 0 && !search && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                <Pin className="h-3.5 w-3.5 text-amber-400" /> Pinned
              </div>
              {sessions.filter(s => s.isPinned).map((s, i) => (
                <SessionCard
                  key={"pin-" + s.id} session={s} index={i}
                  isSelected={selected.has(s.id)} isExpanded={expanded === s.id} copiedId={copiedId}
                  detail={expanded === s.id ? expandedDetail.data : undefined}
                  onToggleSelect={handleToggleSelect} onToggleExpand={(id) => setExpanded(expanded === id ? null : id)}
                  onCopyId={handleCopyId} onCopyResume={handleCopyResume} onOpenFolder={handleOpenFolder}
                  onDelete={(id, e) => { e.stopPropagation(); setDeleteConfirm({ type: "single", id }); }}
                  onSummarize={(id) => summarizeSession.mutate(id)} isSummarizing={summarizeSession.isPending}
                  onTogglePin={(id) => togglePin.mutate(id)} onSaveNote={(id, text) => saveNote.mutate({ id, text })}
                  searchQuery={search}
                />
              ))}
              <div className="border-b border-border/30" />
            </>
          )}
          {sessions.filter(s => !s.isPinned || !!search).map((s, i) => (
            <SessionCard
              key={s.id} session={s} index={i}
              isSelected={selected.has(s.id)} isExpanded={expanded === s.id} copiedId={copiedId}
              detail={expanded === s.id ? expandedDetail.data : undefined}
              onToggleSelect={handleToggleSelect} onToggleExpand={(id) => setExpanded(expanded === id ? null : id)}
              onCopyId={handleCopyId} onCopyResume={handleCopyResume} onOpenFolder={handleOpenFolder}
              onDelete={(id, e) => { e.stopPropagation(); setDeleteConfirm({ type: "single", id }); }}
              onSummarize={(id) => summarizeSession.mutate(id)} isSummarizing={summarizeSession.isPending}
              onTogglePin={(id) => togglePin.mutate(id)} onSaveNote={(id, text) => saveNote.mutate({ id, text })}
              searchQuery={search}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data?.totalPages && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            Page {data.page || page} of {data.totalPages} ({data.total} sessions)
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= (data.totalPages || 1)}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              {deleteConfirm?.type === "all"
                ? `Delete all ${stats?.totalCount ?? 0} sessions?`
                : deleteConfirm?.type === "bulk"
                ? `Delete ${selected.size} session(s)?`
                : "Delete session?"}
            </DialogTitle>
            <DialogDescription>
              {deleteConfirm?.type === "all"
                ? `All session files will be moved to trash${sessions.filter(s => s.isPinned).length > 0 ? ` (${sessions.filter(s => s.isPinned).length} pinned session${sessions.filter(s => s.isPinned).length !== 1 ? "s" : ""} will be kept)` : ""}. You can undo this immediately after.`
                : "Session files will be moved to trash. You can undo this immediately after."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function AnalyticsPanel() {
  const { data: costs } = useCostAnalytics();
  const { data: files } = useFileHeatmap();
  const { data: health } = useHealthAnalytics();
  const { data: stale } = useStaleAnalytics();
  const { data: settings } = useAppSettings();
  const contextLoader = useContextLoader();
  const nlQuery = useNLQuery();
  const [contextProject, setContextProject] = useState("");
  const billingMode = settings?.billingMode || "auto";
  const isSub = billingMode === "subscription" || billingMode === "auto"; // default to subscription view
  const [contextPrompt, setContextPrompt] = useState("");
  const [nlQuestion, setNlQuestion] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Nerve Center */}
      <NerveCenterPanel />

      {/* Continuation Intelligence */}
      <ContinuationPanel />

      {/* NL Query */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 text-blue-400" /> Ask a Question
        </h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MessageCircleQuestion className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="e.g., Which project costs the most? How many sessions this week?"
              value={nlQuestion}
              onChange={e => setNlQuestion(e.target.value)}
              className="pl-9"
              onKeyDown={e => { if (e.key === "Enter" && nlQuestion.length >= 3) nlQuery.mutate(nlQuestion); }}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => nlQuery.mutate(nlQuestion)}
            disabled={nlQuestion.length < 3 || nlQuery.isPending}
          >
            {nlQuery.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ask"}
          </Button>
        </div>
        {nlQuery.data && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <p className="text-sm text-foreground whitespace-pre-wrap">{nlQuery.data.answer}</p>
            <p className="text-[11px] text-muted-foreground/50 mt-1">{nlQuery.data.context} | {nlQuery.data.durationMs}ms</p>
          </div>
        )}
      </div>

      {/* Cost Overview */}
      {costs && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-400" /> {isSub ? "Usage Analytics" : "Cost Analytics"}
            <span className="text-[11px] text-muted-foreground font-normal">({costs.totalSessions} sessions scanned in {costs.durationMs}ms){isSub ? " — Subscription plan" : ""}</span>
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">{isSub ? "Total Tokens" : "Total Cost"}</p>
              <p className="text-2xl font-bold font-mono mt-1 text-green-400">{isSub ? formatTokens(costs.totalInputTokens + costs.totalOutputTokens) : formatUsd(costs.totalCostUsd)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Input Tokens</p>
              <p className="text-2xl font-bold font-mono mt-1">{formatTokens(costs.totalInputTokens)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Output Tokens</p>
              <p className="text-2xl font-bold font-mono mt-1">{formatTokens(costs.totalOutputTokens)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Sessions</p>
              <p className="text-2xl font-bold font-mono mt-1">{costs.totalSessions}</p>
            </div>
          </div>

          {/* By model */}
          <div className="rounded-xl border bg-card p-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-2">Cost by Model</p>
            <div className="space-y-1.5">
              {Object.entries(costs.byModel).sort((a, b) => b[1].cost - a[1].cost).map(([model, data]) => (
                <div key={model} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{model}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-muted-foreground/60">{formatTokens(data.tokens)} tokens</span>
                    <span className="text-muted-foreground/60">{data.sessions} sessions</span>
                    <span className="font-mono font-medium text-green-400 w-20 text-right">{formatUsd(data.cost)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By day (last 14 days) */}
          {costs.byDay.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-2">Daily Spend (last 14 days)</p>
              <div className="space-y-1">
                {costs.byDay.slice(-14).map(d => {
                  const maxCost = Math.max(...costs.byDay.slice(-14).map(x => x.cost));
                  const pct = maxCost > 0 ? (d.cost / maxCost) * 100 : 0;
                  return (
                    <div key={d.date} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground/60 w-20 flex-shrink-0">{d.date.slice(5)}</span>
                      <div className="flex-1 h-4 bg-muted/30 rounded overflow-hidden">
                        <div className="h-full bg-green-500/30 rounded" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono text-green-400 w-16 text-right flex-shrink-0">{formatUsd(d.cost)}</span>
                      <span className="text-muted-foreground/50 w-10 text-right flex-shrink-0">{d.sessions}s</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top sessions by cost */}
          {costs.topSessions.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-2">Most Expensive Sessions</p>
              <div className="space-y-1">
                {costs.topSessions.slice(0, 10).map((s, i) => (
                  <div key={s.sessionId} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground/50 w-5 text-right">#{i + 1}</span>
                    <span className="text-muted-foreground truncate flex-1">{s.firstMessage || "(no message)"}</span>
                    <span className="text-muted-foreground/50">{formatTokens(s.tokens)}</span>
                    <span className="font-mono text-green-400 w-16 text-right font-medium">{formatUsd(s.cost)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By project */}
          {Object.keys(costs.byProject).length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-2">Cost by Project</p>
              <div className="space-y-1">
                {Object.entries(costs.byProject).sort((a, b) => b[1].cost - a[1].cost).slice(0, 10).map(([proj, data]) => (
                  <div key={proj} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-muted-foreground truncate max-w-[300px]">{proj}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground/50">{data.sessions} sessions</span>
                      <span className="font-mono text-green-400 w-16 text-right font-medium">{formatUsd(data.cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* File Heatmap */}
      {files && files.files.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-orange-400" /> File Heatmap
            <span className="text-[11px] text-muted-foreground font-normal">({files.totalFiles} files, {files.totalOperations} operations)</span>
          </h2>
          <div className="rounded-xl border bg-card p-4">
            <div className="space-y-1">
              {files.files.slice(0, 25).map((f, i) => {
                const maxTouch = files.files[0]?.touchCount || 1;
                const pct = (f.touchCount / maxTouch) * 100;
                return (
                  <div key={f.filePath} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1 py-0.5" onClick={() => setSelectedFile(selectedFile === f.filePath ? null : f.filePath)}>
                    <span className="text-muted-foreground/50 w-5 text-right">#{i + 1}</span>
                    <span className="font-mono text-orange-400/80 hover:text-orange-300 truncate flex-1" title={f.filePath}>{f.fileName}</span>
                    <div className="w-32 h-3 bg-muted/30 rounded overflow-hidden flex-shrink-0">
                      <div className="h-full bg-orange-500/40 rounded" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-muted-foreground/60 w-8 text-right">{f.touchCount}</span>
                    <div className="flex gap-1 w-24 flex-shrink-0">
                      {f.operations.read > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 border-blue-500/20 text-blue-400">R:{f.operations.read}</Badge>}
                      {f.operations.edit > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/20 text-amber-400">E:{f.operations.edit}</Badge>}
                      {f.operations.write > 0 && <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/20 text-green-400">W:{f.operations.write}</Badge>}
                    </div>
                    <span className="text-muted-foreground/40 text-[10px] w-12 text-right">{f.sessionCount}s</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* File Timeline */}
      {selectedFile && <FileTimelinePanel filePath={selectedFile} onClose={() => setSelectedFile(null)} />}

      {/* Health Overview */}
      {health && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-red-400" /> Session Health
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Good</p>
              <p className="text-2xl font-bold font-mono mt-1 text-green-400">{health.goodCount}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Fair</p>
              <p className="text-2xl font-bold font-mono mt-1 text-amber-400">{health.fairCount}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Poor</p>
              <p className="text-2xl font-bold font-mono mt-1 text-red-400">{health.poorCount}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Avg Errors</p>
              <p className="text-2xl font-bold font-mono mt-1">{health.avgToolErrors}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium">Avg Retries</p>
              <p className="text-2xl font-bold font-mono mt-1">{health.avgRetries}</p>
            </div>
          </div>
          {health.sessions.length > 0 && (
            <div className="rounded-xl border bg-card p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-2">Problematic Sessions</p>
              <div className="space-y-1">
                {health.sessions.slice(0, 10).map(h => (
                  <div key={h.sessionId} className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${h.healthScore === "poor" ? "border-red-500/30 text-red-400" : "border-amber-500/30 text-amber-400"}`}>
                      {h.healthScore}
                    </Badge>
                    <span className="font-mono text-muted-foreground/60 truncate flex-1">{h.sessionId.slice(0, 8)}...</span>
                    <span className="text-red-400">{h.toolErrors} errors</span>
                    <span className="text-amber-400">{h.retries} retries</span>
                    <span className="text-muted-foreground/50">{h.totalToolCalls} tool calls</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stale Sessions */}
      {stale && (stale.totalStale > 0 || stale.totalEmpty > 0) && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Archive className="h-4 w-4 text-amber-400" /> Stale Sessions
          </h2>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-4 text-sm">
              <span><strong className="text-amber-400">{stale.totalEmpty}</strong> empty sessions</span>
              <span><strong className="text-amber-400">{stale.totalStale}</strong> stale sessions (30+ days, &lt;5 msgs)</span>
              <span className="text-muted-foreground">Reclaimable: <strong>{formatBytes(stale.reclaimableBytes)}</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* Context Loader */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Clipboard className="h-4 w-4 text-cyan-400" /> Smart Context Loader
          <span className="text-[11px] text-muted-foreground font-normal">Generate a context prompt from recent sessions for a project</span>
        </h2>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Project name (e.g. my-app, backend)"
            value={contextProject}
            onChange={e => setContextProject(e.target.value)}
            className="max-w-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (contextProject) {
                contextLoader.mutate(contextProject, {
                  onSuccess: (data) => {
                    setContextPrompt(data.prompt);
                    navigator.clipboard.writeText(data.prompt);
                  },
                });
              }
            }}
            disabled={!contextProject || contextLoader.isPending}
            className="gap-1.5"
          >
            {contextLoader.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clipboard className="h-3.5 w-3.5" />}
            Generate & Copy
          </Button>
          {contextLoader.data && (
            <span className="text-xs text-muted-foreground">
              {contextLoader.data.sessionsUsed} sessions, ~{formatTokens(contextLoader.data.tokensEstimate)} tokens — copied to clipboard
            </span>
          )}
        </div>
        {contextPrompt && (
          <pre className="text-xs font-mono bg-muted/30 rounded-lg p-4 max-h-60 overflow-auto whitespace-pre-wrap text-muted-foreground">{contextPrompt}</pre>
        )}
      </div>

      <ProjectDashboardPanel />
      <WeeklyDigestPanel />
      <PromptLibraryPanel />
      <WorkflowConfigPanel />
      <BashKnowledgePanel />
      <DecisionLogPanel />
    </div>
  );
}

function NerveCenterPanel() {
  const { data } = useNerveCenter();
  if (!data) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <Server className="h-4 w-4 text-cyan-400" /> Operations Nerve Center
        <span className="text-[11px] text-muted-foreground font-normal">(auto-refreshes every 30s)</span>
      </h2>
      <div className="flex gap-2 flex-wrap">
        {data.services.map(svc => (
          <div key={svc.name} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border ${
            svc.status === "up" ? "border-green-500/30 bg-green-500/5 text-green-400" : "border-red-500/30 bg-red-500/5 text-red-400"
          }`}>
            <span className={`w-2 h-2 rounded-full ${svc.status === "up" ? "bg-green-500" : "bg-red-500"}`} />
            {svc.name} :{svc.port}
            {svc.responseMs !== undefined && <span className="text-muted-foreground/50">{svc.responseMs}ms</span>}
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-3 flex items-center justify-between">
        <div>
          <span className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Weekly Spend Pacing</span>
          <p className="text-lg font-bold font-mono text-green-400">{formatUsd(data.costPacing.thisWeek)}</p>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-muted-foreground/60">vs avg {formatUsd(data.costPacing.avgWeek)}</span>
          <p className={`text-lg font-bold font-mono ${data.costPacing.pacingPct > 120 ? "text-red-400" : data.costPacing.pacingPct > 100 ? "text-amber-400" : "text-green-400"}`}>
            {data.costPacing.pacingPct}%
          </p>
        </div>
      </div>
      {data.attentionItems.length > 0 && (
        <div className="space-y-1">
          {data.attentionItems.map((item, i) => (
            <div key={i} className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border ${
              item.severity === "critical" ? "border-red-500/30 bg-red-500/5 text-red-400" :
              item.severity === "warning" ? "border-amber-500/30 bg-amber-500/5 text-amber-400" :
              "border-blue-500/20 bg-blue-500/5 text-blue-400"
            }`}>
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              {item.message}
            </div>
          ))}
        </div>
      )}
      {data.overnightActivity.length > 0 && (
        <div>
          <span className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Recent Activity (12h)</span>
          <div className="mt-1 space-y-0.5">
            {data.overnightActivity.slice(0, 5).map((a, i) => (
              <p key={i} className="text-xs text-muted-foreground">- {a}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContinuationPanel() {
  const { data } = useContinuations();
  const delegate = useDelegate();
  if (!data || data.items.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <ArrowRight className="h-4 w-4 text-amber-400" /> Pick Up Where You Left Off
      </h2>
      <div className="space-y-2">
        {data.items.map(item => (
          <div key={item.sessionId} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium line-clamp-1">{item.firstMessage || "(no message)"}</p>
                <div className="flex gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                  <span>{relativeTime(item.lastTs)}</span>
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                    item.outcome === "error" ? "border-red-500/30 text-red-400" :
                    item.outcome === "abandoned" ? "border-amber-500/30 text-amber-400" :
                    "border-blue-500/30 text-blue-400"
                  }`}>{item.outcome}</Badge>
                  {item.gitBranch && <span className="font-mono">{item.gitBranch}</span>}
                  {(item.uncommittedFiles || 0) > 0 && <span className="text-amber-400">{item.uncommittedFiles} uncommitted</span>}
                </div>
                {item.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>}
              </div>
              <div className="flex gap-1 ml-2 flex-shrink-0">
                <button onClick={() => delegate.mutate({ sessionId: item.sessionId, target: "terminal" })} className="p-1.5 rounded hover:bg-green-500/10" title="Resume in terminal">
                  <TerminalSquare className="h-3.5 w-3.5 text-green-400" />
                </button>
                <button onClick={() => delegate.mutate({ sessionId: item.sessionId, target: "telegram", task: "Continue" })} className="p-1.5 rounded hover:bg-blue-500/10" title="Send to Telegram">
                  <Send className="h-3.5 w-3.5 text-blue-400" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BashKnowledgePanel() {
  const { data } = useBashKnowledge();
  const [bashSearch, setBashSearch] = useState("");
  if (!data) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <TerminalSquare className="h-4 w-4 text-green-400" /> Bash Knowledge Base
        <span className="text-[11px] text-muted-foreground font-normal">({data.uniqueCommands} unique, {data.totalExecutions} total)</span>
      </h2>
      <div className="flex gap-2 flex-wrap">
        {Object.entries(data.byCategory).sort((a, b) => b[1].count - a[1].count).map(([cat, stats]) => (
          <div key={cat} className="text-xs px-2 py-1 rounded border border-border">
            <span className="font-mono">{cat}</span>
            <span className="text-muted-foreground/50 ml-1">{stats.count}x</span>
            <span className={`ml-1 ${stats.successRate >= 90 ? "text-green-400" : stats.successRate >= 70 ? "text-amber-400" : "text-red-400"}`}>{stats.successRate}%</span>
          </div>
        ))}
      </div>
      <Input placeholder="Search commands..." value={bashSearch} onChange={e => setBashSearch(e.target.value)} className="text-xs" />
      {bashSearch.length >= 2 && <BashSearchResults query={bashSearch} />}
      {data.failureHotspots.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <span className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Failure Hotspots</span>
          <div className="mt-1 space-y-1">
            {data.failureHotspots.slice(0, 5).map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-red-400 w-8">{f.failCount}x</span>
                <code className="font-mono text-muted-foreground truncate flex-1">{f.command.slice(0, 60)}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BashSearchResults({ query }: { query: string }) {
  const { data } = useBashSearch(query);
  if (!data) return null;
  return (
    <div className="rounded-xl border bg-card p-3">
      <span className="text-[11px] text-muted-foreground/60">{data.totalMatches} matches</span>
      <div className="mt-1 space-y-1 max-h-40 overflow-auto">
        {data.matches.slice(0, 15).map((m, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${m.succeeded ? "border-green-500/20 text-green-400" : "border-red-500/20 text-red-400"}`}>
              {m.succeeded ? "OK" : "ERR"}
            </Badge>
            <code className="font-mono text-muted-foreground truncate flex-1">{m.command.slice(0, 80)}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionLogPanel() {
  const [decisionSearch, setDecisionSearch] = useState("");
  const { data: decisions } = useDecisions(decisionSearch || undefined);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-yellow-400" /> Decision Log
        <span className="text-[11px] text-muted-foreground font-normal">({decisions?.length || 0} decisions)</span>
      </h2>
      <Input placeholder="Search decisions..." value={decisionSearch} onChange={e => setDecisionSearch(e.target.value)} className="text-xs" />
      {decisions && decisions.length > 0 && (
        <div className="space-y-2 max-h-96 overflow-auto">
          {decisions.slice(0, 20).map(d => (
            <div key={d.id} className="rounded-xl border bg-card p-3 space-y-1">
              <p className="text-sm font-medium">{d.topic}</p>
              <p className="text-xs text-muted-foreground"><strong>Chosen:</strong> {d.chosen}</p>
              {d.alternatives.length > 0 && <p className="text-xs text-muted-foreground/60">Alternatives: {d.alternatives.join(", ")}</p>}
              {d.tradeOffs && <p className="text-xs text-muted-foreground/60">Trade-offs: {d.tradeOffs}</p>}
              <div className="flex gap-1">
                {d.tags.map(t => <Badge key={t} variant="outline" className="text-[9px] px-1 py-0">{t}</Badge>)}
                <span className="text-[10px] text-muted-foreground/40 ml-auto">{d.timestamp.slice(0, 10)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {decisions && decisions.length === 0 && !decisionSearch && (
        <p className="text-xs text-muted-foreground">No decisions yet. Use "Extract Decisions" in expanded session cards to mine decisions from past sessions.</p>
      )}
    </div>
  );
}

function ProjectDashboardPanel() {
  const { data } = useProjectDashboards();
  if (!data || data.projects.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <FolderKanban className="h-4 w-4 text-cyan-400" /> Project Dashboards
        <span className="text-[11px] text-muted-foreground font-normal">({data.projects.length} projects)</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.projects.map(p => (
          <div key={p.projectKey} className="rounded-xl border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium font-mono truncate">{p.projectPath.split("/").pop() || p.projectKey}</span>
              <span className="text-sm font-mono text-green-400">{formatUsd(p.totalCost)}</span>
            </div>
            <div className="flex gap-3 text-[11px] text-muted-foreground">
              <span>{p.totalSessions} sessions</span>
              <span>{p.totalMessages} msgs</span>
              <span>{formatBytes(p.totalSize)}</span>
            </div>
            <div className="flex gap-1">
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-green-500/20 text-green-400">{p.healthBreakdown.good} good</Badge>
              {p.healthBreakdown.fair > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/20 text-amber-400">{p.healthBreakdown.fair} fair</Badge>}
              {p.healthBreakdown.poor > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-red-500/20 text-red-400">{p.healthBreakdown.poor} poor</Badge>}
            </div>
            {p.summaryTopics.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {p.summaryTopics.slice(0, 5).map(t => (
                  <Badge key={t} variant="outline" className="text-[9px] px-1.5 py-0 border-purple-500/20 text-purple-300/70">{t}</Badge>
                ))}
              </div>
            )}
            {p.topFiles.length > 0 && (
              <div className="text-[11px] text-muted-foreground/60">
                Top files: {p.topFiles.map(f => `${f.fileName} (${f.touchCount}x)`).join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyDigestPanel() {
  const { data: digest } = useWeeklyDigest();
  if (!digest) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <Calendar className="h-4 w-4 text-blue-400" /> Weekly Digest
        <span className="text-[11px] text-muted-foreground font-normal">{digest.weekStart} to {digest.weekEnd}</span>
      </h2>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <div><p className="text-[11px] text-muted-foreground/60">Sessions</p><p className="text-xl font-bold font-mono">{digest.totalSessions}</p></div>
          <div><p className="text-[11px] text-muted-foreground/60">Cost</p><p className="text-xl font-bold font-mono text-green-400">{formatUsd(digest.totalCost)}</p></div>
          <div><p className="text-[11px] text-muted-foreground/60">Tokens</p><p className="text-xl font-bold font-mono">{formatTokens(digest.totalTokens)}</p></div>
          <div><p className="text-[11px] text-muted-foreground/60">Health</p><p className="text-xl font-bold font-mono"><span className="text-green-400">{digest.healthSummary.good}</span>/<span className="text-amber-400">{digest.healthSummary.fair}</span>/<span className="text-red-400">{digest.healthSummary.poor}</span></p></div>
        </div>
        {digest.topAccomplishments.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-1">Accomplishments</p>
            <div className="space-y-0.5">
              {digest.topAccomplishments.slice(0, 5).map((a, i) => (
                <p key={i} className="text-xs text-muted-foreground">- {a}</p>
              ))}
            </div>
          </div>
        )}
        {digest.projectBreakdown.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium mb-1">Projects</p>
            <div className="space-y-0.5">
              {digest.projectBreakdown.slice(0, 5).map(p => (
                <div key={p.project} className="flex justify-between text-xs">
                  <span className="font-mono text-muted-foreground truncate">{p.project}</span>
                  <span className="text-muted-foreground/60">{p.sessions}s / {formatUsd(p.cost)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PromptLibraryPanel() {
  const { data: templates } = usePromptTemplates();
  const createPrompt = useCreatePrompt();
  const deletePrompt = useDeletePrompt();
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-400" /> Prompt Library
          <span className="text-[11px] text-muted-foreground font-normal">({templates?.length || 0} templates)</span>
        </h2>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5" /> New Template
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <Input placeholder="Template name" value={newName} onChange={e => setNewName(e.target.value)} />
          <textarea
            placeholder="Prompt text..."
            value={newPrompt}
            onChange={e => setNewPrompt(e.target.value)}
            className="w-full h-24 text-xs font-mono bg-muted/30 rounded-lg p-3 border border-border resize-none"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={!newName || !newPrompt || createPrompt.isPending} onClick={() => {
              createPrompt.mutate({ name: newName, prompt: newPrompt }, {
                onSuccess: () => { setNewName(""); setNewPrompt(""); setShowForm(false); },
              });
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={t.id} className="rounded-xl border bg-card p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 font-mono mt-0.5">{t.prompt}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  className="p-1.5 rounded hover:bg-accent transition-colors"
                  title="Copy prompt"
                  onClick={() => { navigator.clipboard.writeText(t.prompt); setCopiedPromptId(t.id); setTimeout(() => setCopiedPromptId(null), 1500); }}
                >
                  {copiedPromptId === t.id ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                <button
                  className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
                  title="Delete"
                  onClick={() => deletePrompt.mutate(t.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowConfigPanel() {
  const { data: config } = useWorkflowConfig();
  const updateWorkflow = useUpdateWorkflow();
  const runWorkflows = useRunWorkflows();

  if (!config) return null;

  const toggle = (key: keyof typeof config) => {
    updateWorkflow.mutate({ [key]: !config[key] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Settings className="h-4 w-4 text-gray-400" /> Auto-Workflows
        </h2>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => runWorkflows.mutate()} disabled={runWorkflows.isPending}>
          {runWorkflows.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run Now
        </Button>
      </div>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        {([
          { key: "autoSummarize" as const, label: "Auto-summarize new sessions", desc: "Summarize completed sessions automatically" },
          { key: "autoArchiveStale" as const, label: "Flag stale sessions", desc: "Identify sessions older than 30 days with <5 messages" },
          { key: "autoTagByPath" as const, label: "Auto-tag by file paths", desc: "Tag sessions based on which files were modified" },
        ]).map(item => (
          <div key={item.key} className="flex items-center justify-between">
            <div>
              <p className="text-sm">{item.label}</p>
              <p className="text-[11px] text-muted-foreground">{item.desc}</p>
            </div>
            <button
              onClick={() => toggle(item.key)}
              className={`w-10 h-5 rounded-full transition-colors ${config[item.key] ? "bg-blue-500" : "bg-muted"}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white transition-transform ${config[item.key] ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Daily cost alert</p>
            <p className="text-[11px] text-muted-foreground">Notify when daily spend exceeds threshold</p>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">$</span>
            <input
              type="number"
              value={config.costAlertThreshold || ""}
              onChange={e => updateWorkflow.mutate({ costAlertThreshold: e.target.value ? Number(e.target.value) : null })}
              placeholder="off"
              className="w-16 text-xs font-mono px-2 py-1 rounded border border-border bg-background"
            />
          </div>
        </div>
      </div>
      {runWorkflows.data && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {(runWorkflows.data as { ran: string[]; errors: string[] }).ran.map((r: string, i: number) => <p key={i} className="text-green-400">- {r}</p>)}
          {(runWorkflows.data as { ran: string[]; errors: string[] }).errors.map((e: string, i: number) => <p key={i} className="text-red-400">- {e}</p>)}
        </div>
      )}
    </div>
  );
}

function SessionActionsExtended({ sessionId }: { sessionId: string }) {
  const delegate = useDelegate();
  const extractDecisions = useExtractDecisions();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-muted-foreground/60">Delegate:</span>
      <button onClick={() => delegate.mutate({ sessionId, target: "terminal" })} className="text-[11px] px-2 py-1 rounded border border-green-500/20 text-green-400 hover:bg-green-500/10">
        <TerminalSquare className="h-3 w-3 inline mr-0.5" />Terminal
      </button>
      <button onClick={() => delegate.mutate({ sessionId, target: "telegram", task: "Continue this session" })} className="text-[11px] px-2 py-1 rounded border border-blue-500/20 text-blue-400 hover:bg-blue-500/10">
        <Send className="h-3 w-3 inline mr-0.5" />Telegram
      </button>
      <button onClick={() => delegate.mutate({ sessionId, target: "voice" })} className="text-[11px] px-2 py-1 rounded border border-purple-500/20 text-purple-400 hover:bg-purple-500/10">
        <Phone className="h-3 w-3 inline mr-0.5" />Voice
      </button>
      <span className="text-muted-foreground/30">|</span>
      <button
        onClick={() => extractDecisions.mutate(sessionId)}
        disabled={extractDecisions.isPending}
        className="text-[11px] px-2 py-1 rounded border border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/10"
      >
        {extractDecisions.isPending ? <Loader2 className="h-3 w-3 inline mr-0.5 animate-spin" /> : <Lightbulb className="h-3 w-3 inline mr-0.5" />}
        Extract Decisions
      </button>
      {delegate.data && (
        <span className={`text-[11px] ${delegate.data.status === "dispatched" ? "text-green-400" : "text-red-400"}`}>
          {delegate.data.message}
        </span>
      )}
      {extractDecisions.data && (
        <span className="text-[11px] text-yellow-400">{extractDecisions.data.count} decisions found</span>
      )}
    </div>
  );
}

function FileTimelinePanel({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  const { data, isLoading } = useFileTimeline(filePath);
  const fileName = filePath.replace(/\\/g, "/").split("/").pop() || filePath;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <FileText className="h-4 w-4 text-orange-400" /> Timeline: <code className="font-mono text-orange-400">{fileName}</code>
          {data && <span className="text-[11px] text-muted-foreground font-normal">({data.totalSessions} sessions, {data.entries.length} changes)</span>}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </div>
      {isLoading && <div className="text-sm text-muted-foreground">Loading...</div>}
      {data && data.entries.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-2 max-h-96 overflow-auto">
          {data.entries.map((e, i) => (
            <div key={i} className="border-b border-border/30 pb-2 last:border-0">
              <div className="flex items-center gap-2 text-xs mb-1">
                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${e.tool === "Write" ? "border-green-500/20 text-green-400" : "border-amber-500/20 text-amber-400"}`}>
                  {e.tool}
                </Badge>
                <span className="text-muted-foreground/50 font-mono">{e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</span>
                <span className="text-muted-foreground truncate flex-1">{e.firstMessage}</span>
              </div>
              {e.tool === "Edit" && e.oldString && e.newString && (
                <div className="font-mono text-[11px] space-y-1 ml-4">
                  <pre className="bg-red-500/10 text-red-300 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap max-h-16">- {e.oldString.slice(0, 150)}</pre>
                  <pre className="bg-green-500/10 text-green-300 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap max-h-16">+ {e.newString.slice(0, 150)}</pre>
                </div>
              )}
              {e.tool === "Write" && e.content && (
                <pre className="font-mono text-[11px] bg-green-500/10 text-green-300 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap max-h-16 ml-4">{e.content.slice(0, 200)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
      {data && data.entries.length === 0 && <p className="text-xs text-muted-foreground">No changes found for this file</p>}
    </div>
  );
}

function SessionCard({
  session: s,
  index: i,
  isSelected,
  isExpanded,
  copiedId,
  detail,
  onToggleSelect,
  onToggleExpand,
  onCopyId,
  onCopyResume,
  onOpenFolder,
  onDelete,
  onSummarize,
  isSummarizing,
  onTogglePin,
  onSaveNote,
  searchQuery,
}: {
  session: SessionData;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  copiedId: string | null;
  detail?: any;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onToggleExpand: (id: string) => void;
  onCopyId: (id: string, e: React.MouseEvent) => void;
  onCopyResume: (id: string, e: React.MouseEvent) => void;
  onOpenFolder: (filePath: string, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onSummarize: (id: string) => void;
  isSummarizing: boolean;
  onTogglePin?: (id: string) => void;
  onSaveNote?: (id: string, text: string) => void;
  searchQuery?: string;
}) {
  const resumeCopied = copiedId === "resume:" + s.id;
  const [noteText, setNoteText] = useState(s.note || "");
  const [editingNote, setEditingNote] = useState(false);

  return (
    <Card
      data-session-id={s.id}
      className={`group card-hover animate-fade-in-up cursor-pointer ${s.isEmpty ? "opacity-50" : ""} ${isSelected ? "ring-1 ring-blue-500/50" : ""} ${isExpanded ? "ring-2 ring-blue-500/60 shadow-[0_0_20px_rgba(59,130,246,0.15)]" : ""}`}
      style={{ animationDelay: `${i * 30}ms` }}
      onClick={() => onToggleExpand(s.id)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            onClick={(e) => onToggleSelect(s.id, e)}
            onChange={() => {}}
            className="mt-1.5 h-4 w-4 rounded border-border accent-blue-500 cursor-pointer"
          />

          {/* Active indicator */}
          {s.isActive && (
            <span className="mt-2 w-2.5 h-2.5 rounded-full bg-green-500 pulse-ring flex-shrink-0" style={{ color: "#22c55e40" }} />
          )}

          {/* Row number */}
          <span className="text-xs font-mono text-muted-foreground/50 mt-1.5 w-6 text-right flex-shrink-0">
            #{i + 1}
          </span>

          {/* Main content — first message is primary, slug is secondary */}
          <div className="flex-1 min-w-0">
            {/* First message as title */}
            {s.firstMessage ? (
              <p className="text-sm font-medium line-clamp-1"><HighlightText text={s.firstMessage} query={searchQuery || ""} /></p>
            ) : (
              <p className="text-sm text-muted-foreground/50 italic">(empty session)</p>
            )}
            {/* Meta line: time + slug + tags */}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                {relativeTime(s.lastTs)}
              </span>
              <span className="text-muted-foreground/30 text-[11px]">/</span>
              <button
                className="text-[10px] text-muted-foreground/40 font-mono hover:text-blue-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(s.id); onCopyId(s.id, e); }}
                title="Click to copy UUID"
              >{s.id}</button>
              {s.slug && (
                <>
                  <span className="text-muted-foreground/30 text-[11px]">/</span>
                  <span className="text-[11px] text-muted-foreground/60 font-mono truncate max-w-[180px]"><HighlightText text={s.slug} query={searchQuery || ""} /></span>
                </>
              )}
              {s.tags.length > 0 && (
                <>
                  <span className="text-muted-foreground/30 text-[11px]">/</span>
                  <div className="flex gap-1">
                    {s.tags.map(t => (
                      <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                    ))}
                  </div>
                </>
              )}
              {s.hasSummary && (
                <>
                  <span className="text-muted-foreground/30 text-[11px]">/</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">
                    <Sparkles className="h-2.5 w-2.5 mr-0.5" />AI
                  </Badge>
                  {s.summaryTopics && s.summaryTopics.length > 0 && s.summaryTopics.slice(0, 3).map(t => (
                    <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/20 text-purple-300/70">{t}</Badge>
                  ))}
                </>
              )}
              {s.note && (
                <>
                  <span className="text-muted-foreground/30 text-[11px]">/</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-500/30 text-yellow-400">
                    <StickyNote className="h-2.5 w-2.5 mr-0.5" />Note
                  </Badge>
                </>
              )}
            </div>
          </div>

          {/* Right side stats */}
          <div className="text-right flex-shrink-0 space-y-0.5">
            <div className="text-xs font-mono text-muted-foreground tabular-nums">
              {s.messageCount} msgs
            </div>
            <div className="text-xs font-mono text-muted-foreground tabular-nums">
              {formatBytes(s.sizeBytes)}
            </div>
            <div className="text-xs font-mono text-muted-foreground/50 tabular-nums">
              {formatDuration(s.firstTs, s.lastTs)}
            </div>
            {s.sizeBytes > 1024 && (
              <div className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">
                ~{formatTokens(Math.round(s.sizeBytes / 4))}
              </div>
            )}
          </div>

          {/* Pin indicator (clickable) */}
          {s.isPinned && onTogglePin && (
            <button onClick={(e) => { e.stopPropagation(); onTogglePin(s.id); }} className="flex-shrink-0 mt-1.5 hover:opacity-70" title="Unpin">
              <Pin className="h-3.5 w-3.5 text-amber-400" />
            </button>
          )}

          {/* Hover actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {onTogglePin && !s.isPinned && (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePin(s.id); }}
                className="p-1.5 rounded hover:bg-amber-500/10 transition-colors"
                title="Pin"
              >
                <Pin className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
            <button
              onClick={(e) => onCopyResume(s.id, e)}
              className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
              title="Copy resume command"
            >
              {resumeCopied ? (
                <Check className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Terminal className="h-3.5 w-3.5 text-green-400" />
              )}
            </button>
            <button
              onClick={(e) => onOpenFolder(s.filePath, e)}
              className="p-1.5 rounded hover:bg-accent transition-colors"
              title="Open folder"
            >
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={(e) => onCopyId(s.id, e)}
              className="p-1.5 rounded hover:bg-accent transition-colors"
              title="Copy UUID"
            >
              {copiedId === s.id ? (
                <Check className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); window.open(`/api/sessions/${s.id}/export/html`, "_blank"); }}
              className="p-1.5 rounded hover:bg-cyan-500/10 transition-colors"
              title="Export as HTML"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
            </button>
            <button
              onClick={(e) => onDelete(s.id, e)}
              className="p-1.5 rounded hover:bg-red-500/10 transition-colors"
              title="Delete session"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </button>
          </div>

          {/* Expand indicator */}
          <div className="mt-1.5 flex-shrink-0">
            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground/50" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
          </div>
        </div>

        {/* Expanded detail */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
            {/* Full first message */}
            {s.firstMessage && (
              <div>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">First Message</span>
                <p className="text-sm mt-1 text-muted-foreground leading-relaxed">{s.firstMessage.slice(0, 500)}</p>
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground/60">UUID</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <code className="font-mono text-muted-foreground truncate">{s.id}</code>
                  <button onClick={(e) => onCopyId(s.id, e)} className="p-0.5 rounded hover:bg-accent">
                    {copiedId === s.id ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                  </button>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground/60">Slug</span>
                <p className="font-mono mt-0.5">{s.slug || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground/60">First</span>
                <p className="font-mono mt-0.5">{s.firstTs ? new Date(s.firstTs).toLocaleString() : "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground/60">Last</span>
                <p className="font-mono mt-0.5">{s.lastTs ? new Date(s.lastTs).toLocaleString() : "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground/60">Size</span>
                <p className="font-mono mt-0.5">{formatBytes(s.sizeBytes)}</p>
              </div>
              <div>
                <span className="text-muted-foreground/60">Messages</span>
                <p className="font-mono mt-0.5">{s.messageCount}</p>
              </div>
              <div>
                <span className="text-muted-foreground/60">Git Branch</span>
                <p className="font-mono mt-0.5">{s.gitBranch || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground/60">Version</span>
                <p className="font-mono mt-0.5">{s.version || "-"}</p>
              </div>
            </div>

            {/* Resume command */}
            <div>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Resume Command</span>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-xs font-mono bg-muted px-3 py-1.5 rounded flex-1">claude --resume {s.id}</code>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={(e) => onCopyResume(s.id, e)}>
                  {resumeCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {resumeCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={(e) => onOpenFolder(s.filePath, e)}>
                <FolderOpen className="h-3.5 w-3.5" /> Open Folder
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={(e) => { e.stopPropagation(); onSummarize(s.id); }}
                disabled={isSummarizing}
              >
                {isSummarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {s.hasSummary ? "Re-summarize" : "Summarize"}
              </Button>
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={(e) => onDelete(s.id, e)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete Session
              </Button>
            </div>

            {/* Delegation + Decisions */}
            <SessionActionsExtended sessionId={s.id} />

            {/* AI Summary */}
            {s.hasSummary && <SessionSummarySection sessionId={s.id} />}

            {/* Note */}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StickyNote className="h-3.5 w-3.5 text-yellow-400" />
                <span className="text-[11px] uppercase tracking-wider text-yellow-400 font-medium">Note</span>
                {!editingNote && (
                  <button onClick={(e) => { e.stopPropagation(); setEditingNote(true); setNoteText(s.note || ""); }} className="text-[11px] text-muted-foreground hover:text-foreground">
                    {s.note ? "edit" : "+ add note"}
                  </button>
                )}
              </div>
              {s.note && !editingNote && (
                <p className="text-xs text-muted-foreground bg-yellow-500/5 border border-yellow-500/20 rounded px-3 py-2">{s.note}</p>
              )}
              {editingNote && (
                <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="Add a note about this session..."
                    className="flex-1 text-xs font-mono bg-muted/30 rounded px-3 py-2 border border-border resize-none h-16"
                    autoFocus
                  />
                  <div className="flex flex-col gap-1">
                    <Button size="sm" onClick={() => { if (onSaveNote) onSaveNote(s.id, noteText); setEditingNote(false); }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingNote(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Cost + Commits + Diffs */}
            <SessionCostCommits sessionId={s.id} />
            <SessionDiffsViewer sessionId={s.id} />

            {/* Message timeline */}
            {detail?.records && detail.records.length > 0 && (
              <div>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Message Timeline</span>
                <div className="mt-2 space-y-1.5 max-h-60 overflow-auto">
                  {detail.records.slice(0, 10).map((r: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 flex-shrink-0 mt-0.5 ${
                          r.role === "user" ? "border-blue-500/30 text-blue-400" : "border-green-500/30 text-green-400"
                        }`}
                      >
                        {r.role || r.type}
                      </Badge>
                      <span className="text-muted-foreground/50 font-mono flex-shrink-0 w-14">
                        {r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                      <span className="text-muted-foreground line-clamp-1">{r.contentPreview || "(no content)"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const outcomeColors: Record<string, string> = {
  completed: "border-green-500/30 text-green-400",
  abandoned: "border-amber-500/30 text-amber-400",
  ongoing: "border-blue-500/30 text-blue-400",
  error: "border-red-500/30 text-red-400",
};

function SessionSummarySection({ sessionId }: { sessionId: string }) {
  const { data: summary } = useSessionSummary(sessionId);

  if (!summary) return null;

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-[11px] uppercase tracking-wider text-purple-400 font-medium">AI Summary</span>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${outcomeColors[summary.outcome] || "border-border text-muted-foreground"}`}>
          {summary.outcome}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{summary.summary}</p>
      {summary.topics.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {summary.topics.map(t => (
            <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/20 text-purple-300/80">{t}</Badge>
          ))}
        </div>
      )}
      {summary.toolsUsed.length > 0 && (
        <div className="text-[11px] text-muted-foreground/60">
          Tools: {summary.toolsUsed.join(", ")}
        </div>
      )}
      {summary.filesModified.length > 0 && (
        <div className="text-[11px] text-muted-foreground/60">
          Files: {summary.filesModified.slice(0, 5).map(f => f.split("/").pop()).join(", ")}{summary.filesModified.length > 5 ? ` +${summary.filesModified.length - 5} more` : ""}
        </div>
      )}
    </div>
  );
}

function SessionCostCommits({ sessionId }: { sessionId: string }) {
  const { data: cost } = useSessionCost(sessionId);
  const { data: commitsData } = useSessionCommits(sessionId);
  const commits = commitsData?.commits || [];

  if (!cost && commits.length === 0) return null;

  return (
    <div className="space-y-2">
      {cost && cost.estimatedCostUsd > 0 && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-3.5 w-3.5 text-green-400" />
            <span className="text-[11px] uppercase tracking-wider text-green-400 font-medium">Session Cost</span>
            <span className="text-sm font-mono font-bold text-green-400 ml-auto">{formatUsd(cost.estimatedCostUsd)}</span>
          </div>
          <div className="flex gap-4 text-[11px] text-muted-foreground">
            <span>Input: {formatTokens(cost.inputTokens)}</span>
            <span>Output: {formatTokens(cost.outputTokens)}</span>
            {cost.cacheReadTokens > 0 && <span>Cache read: {formatTokens(cost.cacheReadTokens)}</span>}
            <span>Models: {cost.models.join(", ")}</span>
          </div>
        </div>
      )}
      {commits.length > 0 && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <GitCommit className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-[11px] uppercase tracking-wider text-cyan-400 font-medium">Linked Commits ({commits.length})</span>
          </div>
          <div className="space-y-1">
            {commits.map(c => (
              <div key={c.hash} className="flex items-center gap-2 text-xs">
                <code className="font-mono text-cyan-400/70">{c.hash.slice(0, 7)}</code>
                <span className="text-muted-foreground truncate flex-1">{c.message}</span>
                <span className="text-muted-foreground/50 flex-shrink-0">{c.filesChanged} files</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionDiffsViewer({ sessionId }: { sessionId: string }) {
  const [showDiffs, setShowDiffs] = useState(false);
  const { data } = useSessionDiffs(showDiffs ? sessionId : undefined);

  return (
    <div>
      <button
        onClick={() => setShowDiffs(!showDiffs)}
        className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
      >
        <FileText className="h-3 w-3" />
        {showDiffs ? "Hide" : "Show"} file changes {data ? `(${data.totalDiffs})` : ""}
      </button>
      {showDiffs && data && data.diffs.length > 0 && (
        <div className="mt-2 space-y-2 max-h-80 overflow-auto">
          {data.diffs.map((d, i) => (
            <div key={i} className="rounded border border-border/50 p-2 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${d.tool === "Write" ? "border-green-500/20 text-green-400" : "border-amber-500/20 text-amber-400"}`}>
                  {d.tool}
                </Badge>
                <span className="font-mono text-muted-foreground truncate">{d.filePath.split("/").pop()}</span>
                <span className="text-muted-foreground/40 text-[10px] ml-auto">{d.timestamp ? new Date(d.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
              </div>
              {d.tool === "Edit" && d.oldString && d.newString && (
                <div className="font-mono text-[11px] space-y-1">
                  <pre className="bg-red-500/10 text-red-300 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap max-h-20">- {d.oldString.slice(0, 200)}</pre>
                  <pre className="bg-green-500/10 text-green-300 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap max-h-20">+ {d.newString.slice(0, 200)}</pre>
                </div>
              )}
              {d.tool === "Write" && d.content && (
                <pre className="font-mono text-[11px] bg-green-500/10 text-green-300 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap max-h-20">{d.content.slice(0, 300)}</pre>
              )}
            </div>
          ))}
        </div>
      )}
      {showDiffs && data && data.diffs.length === 0 && (
        <p className="text-[11px] text-muted-foreground mt-1">No file changes found in this session</p>
      )}
    </div>
  );
}

function DeepSearchCard({
  match,
  index,
  searchQuery,
  isExpanded,
  onToggleExpand,
  onCopyResume,
  copiedId,
  onSummarize,
  isSummarizing,
}: {
  match: DeepSearchMatch;
  index: number;
  searchQuery: string;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  onCopyResume: (id: string, e: React.MouseEvent) => void;
  copiedId: string | null;
  onSummarize: (id: string) => void;
  isSummarizing: boolean;
}) {
  const s = match.session;
  const resumeCopied = copiedId === "resume:" + s.id;

  return (
    <Card
      className="group card-hover animate-fade-in-up cursor-pointer"
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={() => onToggleExpand(s.id)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-xs font-mono text-muted-foreground/50 mt-1.5 w-6 text-right flex-shrink-0">
            #{index + 1}
          </span>

          <div className="flex-1 min-w-0 space-y-2">
            {/* Session title */}
            <div className="flex items-center gap-2">
              {s.firstMessage ? (
                <p className="text-sm font-medium line-clamp-1 flex-1"><HighlightText text={s.firstMessage} query={searchQuery} /></p>
              ) : (
                <p className="text-sm text-muted-foreground/50 italic flex-1">(empty session)</p>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400 flex-shrink-0">
                {match.matchCount} match{match.matchCount !== 1 ? "es" : ""}
              </Badge>
            </div>

            {/* Match snippets (show up to 3) */}
            <div className="space-y-1">
              {match.matches.slice(0, 3).map((m, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 flex-shrink-0 mt-0.5 ${
                      m.role === "user" ? "border-blue-500/30 text-blue-400" : "border-green-500/30 text-green-400"
                    }`}
                  >
                    {m.role}
                  </Badge>
                  <span className="text-muted-foreground line-clamp-2">
                    <HighlightText text={m.text} query={searchQuery} />
                  </span>
                </div>
              ))}
              {match.matches.length > 3 && (
                <span className="text-[11px] text-muted-foreground/50">+{match.matches.length - 3} more matches</span>
              )}
            </div>

            {/* Meta line */}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
              <span>{relativeTime(s.lastTs)}</span>
              <span className="text-muted-foreground/30">/</span>
              <span>{s.messageCount} msgs</span>
              <span className="text-muted-foreground/30">/</span>
              <span>{formatBytes(s.sizeBytes)}</span>
              {s.hasSummary && (
                <>
                  <span className="text-muted-foreground/30">/</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">
                    <Sparkles className="h-2.5 w-2.5 mr-0.5" />AI
                  </Badge>
                </>
              )}
            </div>
          </div>

          {/* Hover actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={(e) => onCopyResume(s.id, e)}
              className="p-1.5 rounded hover:bg-green-500/10 transition-colors"
              title="Copy resume command"
            >
              {resumeCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Terminal className="h-3.5 w-3.5 text-green-400" />}
            </button>
          </div>

          <div className="mt-1.5 flex-shrink-0">
            {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground/50" /> : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />}
          </div>
        </div>

        {/* Expanded: show all matches + summary */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
            {/* All matches */}
            <div>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">All Matches</span>
              <div className="mt-2 space-y-1.5 max-h-60 overflow-auto">
                {match.matches.map((m, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 flex-shrink-0 mt-0.5 ${
                        m.role === "user" ? "border-blue-500/30 text-blue-400" : "border-green-500/30 text-green-400"
                      }`}
                    >
                      {m.role}
                    </Badge>
                    <span className="text-muted-foreground">
                      <HighlightText text={m.text} query={searchQuery} />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary */}
            {s.hasSummary && <SessionSummarySection sessionId={s.id} />}

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={(e) => onCopyResume(s.id, e)}>
                {resumeCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Terminal className="h-3.5 w-3.5" />}
                {resumeCopied ? "Copied" : "Resume"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={(e) => { e.stopPropagation(); onSummarize(s.id); }}
                disabled={isSummarizing}
              >
                {isSummarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {s.hasSummary ? "Re-summarize" : "Summarize"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
