import { useState } from "react";
import { useSessions, useSessionDetail, useDeleteSession, useBulkDeleteSessions, useDeleteAllSessions, useUndoDeleteSessions } from "@/hooks/use-entities";
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
} from "lucide-react";
import type { SessionData } from "@shared/types";
import { formatBytes, relativeTime as _relativeTime } from "@/lib/utils";

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

  // Read project filter from URL
  const urlParams = new URLSearchParams(window.location.search);
  const [projectFilter, setProjectFilter] = useState(urlParams.get("project") || "");

  const [sort, order] = sortKey.split(":") as [string, string];
  const { data, isLoading } = useSessions({ q: search || undefined, sort, order, hideEmpty, activeOnly, project: projectFilter || undefined });
  const expandedDetail = useSessionDetail(expanded || undefined);
  const deleteSession = useDeleteSession();
  const bulkDelete = useBulkDeleteSessions();
  const deleteAll = useDeleteAllSessions();
  const undoDelete = useUndoDeleteSessions();

  const sessions = data?.sessions || [];
  const stats = data?.stats;

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
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search sessions..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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

      {/* Session list */}
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : sessions.length === 0 ? (
        <div className="text-muted-foreground text-center py-12">No sessions found</div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s, i) => (
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
            />
          ))}
        </div>
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
                ? "All session files will be moved to trash. You can undo this immediately after."
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
}) {
  const resumeCopied = copiedId === "resume:" + s.id;

  return (
    <Card
      className={`group card-hover animate-fade-in-up cursor-pointer ${s.isEmpty ? "opacity-50" : ""} ${isSelected ? "ring-1 ring-blue-500/50" : ""}`}
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
              <p className="text-sm font-medium line-clamp-1">{s.firstMessage}</p>
            ) : (
              <p className="text-sm text-muted-foreground/50 italic">(empty session)</p>
            )}
            {/* Meta line: time + slug + tags */}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                {relativeTime(s.lastTs)}
              </span>
              {s.slug && (
                <>
                  <span className="text-muted-foreground/30 text-[11px]">/</span>
                  <span className="text-[11px] text-muted-foreground/60 font-mono truncate max-w-[180px]">{s.slug}</span>
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
          </div>

          {/* Hover actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
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
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={(e) => onDelete(s.id, e)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete Session
              </Button>
            </div>

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
