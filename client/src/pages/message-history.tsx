import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/skeleton";
import {
  Search,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Clock,
  FolderOpen,
  User,
  Bot,
  Wrench,
  Loader2,
  Terminal,
  Check,
} from "lucide-react";
import { useOpenSession } from "@/hooks/use-sessions";
import { relativeTime, shortModel } from "@/lib/utils";
import type { SessionData, SessionStats } from "@shared/types";

const rt = (s: string | null) => s ? relativeTime(s) : "-";

interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
  tokenCount?: number;
  hasToolUse?: boolean;
  toolNames?: string[];
}

interface MessagesResponse {
  sessionId: string;
  totalMessages: number;
  messages: SessionMessage[];
}

interface SearchMatch {
  role: "user" | "assistant";
  text: string;        // ~200-char snippet centred on the match
  timestamp: string;
}
interface DeepSearchItem {
  sessionId: string;
  session: SessionData;
  matches: SearchMatch[];
  matchCount: number;
}
interface DeepSearchResponse {
  results: DeepSearchItem[];
  totalMatches: number;
  searchedSessions: number;
  durationMs: number;
}

function formatTime(timestamp: string): string {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function lastPathSegment(fullPath: string): string {
  if (!fullPath || fullPath === "(no project)") return fullPath || "";
  const normalized = fullPath.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || fullPath;
}

export default function MessageHistory() {
  const [search, setSearch] = useState("");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ sessions: SessionData[]; stats: SessionStats }>({
    queryKey: [`/api/sessions?sort=lastTs&order=desc&hideEmpty=true`],
    staleTime: 60000,
  });

  const sessions = data?.sessions || [];

  // Real message-content search via the deep-search backend (matches actual
  // message text + summaries, not just session titles). Kicks in at 2+ chars.
  const trimmed = search.trim();
  const searching = trimmed.length >= 2;
  const { data: searchData, isFetching: searchLoading } = useQuery<DeepSearchResponse>({
    queryKey: [`/api/sessions/search?q=${encodeURIComponent(trimmed)}&field=all&limit=50`],
    enabled: searching,
    staleTime: 30000,
  });

  // When not searching, show the full chronological list. (Search switches to
  // the deep-search results below — it matches message content, not just titles.)
  const filteredSessions = sessions;

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient">Message History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {searching
              ? <>Searching message content{searchData ? <> · {searchData.totalMatches} match{searchData.totalMatches !== 1 ? "es" : ""} in {searchData.results.length} session{searchData.results.length !== 1 ? "s" : ""}</> : "…"}</>
              : <>Chronological timeline of all messages across {sessions.length} session{sessions.length !== 1 ? "s" : ""}</>}
          </p>
        </div>
        <div className="relative w-72">
          {searchLoading
            ? <Loader2 className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground animate-spin" />
            : <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />}
          <Input
            placeholder="Search all messages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Search results (message content) */}
      {searching ? (
        searchLoading && !searchData ? (
          <ListSkeleton rows={6} />
        ) : (searchData?.results.length ?? 0) === 0 ? (
          <div className="text-muted-foreground text-center py-12">
            No messages match “{trimmed}”
          </div>
        ) : (
          <div className="space-y-2">
            {searchData!.results.map((r, i) => (
              <SessionRow
                key={r.sessionId}
                session={r.session}
                index={i}
                matches={r.matches}
                matchCount={r.matchCount}
                isExpanded={expandedSession === r.sessionId}
                onToggle={() => setExpandedSession(expandedSession === r.sessionId ? null : r.sessionId)}
              />
            ))}
          </div>
        )
      ) : /* Chronological list */ isLoading ? (
        <ListSkeleton rows={6} />
      ) : filteredSessions.length === 0 ? (
        <div className="text-muted-foreground text-center py-12">
          No sessions with messages found
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSessions.map((session, i) => (
            <SessionRow
              key={session.id}
              session={session}
              index={i}
              isExpanded={expandedSession === session.id}
              onToggle={() =>
                setExpandedSession(expandedSession === session.id ? null : session.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({
  session,
  index,
  isExpanded,
  onToggle,
  matches,
  matchCount,
}: {
  session: SessionData;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  matches?: SearchMatch[];
  matchCount?: number;
}) {
  const project = lastPathSegment(session.projectKey);
  const openSession = useOpenSession();
  const [openPhase, setOpenPhase] = useState<"idle" | "opening" | "done">("idle");
  const handleOpenTerminal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenPhase("opening");
    openSession.mutate(session.id, {
      onSettled: () => { setOpenPhase("done"); setTimeout(() => setOpenPhase("idle"), 2000); },
    });
  };

  return (
    <Card
      className={`card-hover animate-fade-in-up cursor-pointer ${isExpanded ? "ring-1 ring-blue-500/30" : ""}`}
      style={{ animationDelay: `${Math.min(index, 20) * 30}ms` }}
    >
      <CardContent className="p-0">
        {/* Session header — always visible */}
        <div
          className="flex items-center gap-3 p-4 hover:bg-accent/20 transition-colors"
          onClick={onToggle}
        >
          {/* Expand icon */}
          <div className="flex-shrink-0 text-muted-foreground/50">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium line-clamp-1">
              {session.firstMessage || session.slug || "(untitled)"}
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {rt(session.lastTs)}
              </span>
              {project && (
                <>
                  <span className="text-muted-foreground/30 text-[11px]">/</span>
                  <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                    <FolderOpen className="h-3 w-3" />
                    {project}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Right side stats */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {matchCount != null && (
              <Badge className="text-[10px] px-1.5 py-0 bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/20">
                {matchCount} match{matchCount !== 1 ? "es" : ""}
              </Badge>
            )}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="font-mono tabular-nums">{session.messageCount}</span>
            </div>
            <span className="text-[11px] text-muted-foreground/50 font-mono">
              {formatDate(session.lastTs)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              disabled={openPhase === "opening"}
              onClick={handleOpenTerminal}
              title={`Open a terminal in ${session.cwd || "the session's directory"} and resume this session`}
            >
              {openPhase === "opening" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-green-400" />
              ) : openPhase === "done" ? (
                <Check className="h-3.5 w-3.5 text-green-400" />
              ) : (
                <Terminal className="h-3.5 w-3.5 text-green-400" />
              )}
              {openPhase === "opening" ? "Opening…" : openPhase === "done" ? "Opened" : "Open"}
            </Button>
          </div>
        </div>

        {/* Matched snippets (search mode, collapsed) — click the row to see the full thread */}
        {!isExpanded && matches && matches.length > 0 && (
          <div className="px-4 pb-3 pl-11 space-y-1.5" onClick={onToggle}>
            {matches.slice(0, 4).map((m, mi) => (
              <div key={mi} className="flex items-start gap-1.5 text-[11px]">
                {m.role === "user"
                  ? <User className="h-3 w-3 text-cyan-400 mt-0.5 flex-shrink-0" />
                  : <Bot className="h-3 w-3 text-purple-400 mt-0.5 flex-shrink-0" />}
                <span className="text-muted-foreground/80 line-clamp-2">{m.text}</span>
              </div>
            ))}
            {matchCount != null && matchCount > 4 && (
              <p className="text-[10px] text-muted-foreground/50 pl-[18px]">+{matchCount - 4} more match{matchCount - 4 !== 1 ? "es" : ""}</p>
            )}
          </div>
        )}

        {/* Expanded messages — lazy loaded */}
        {isExpanded && (
          <ExpandedMessages sessionId={session.id} />
        )}
      </CardContent>
    </Card>
  );
}

function ExpandedMessages({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useQuery<MessagesResponse>({
    queryKey: [`/api/sessions/${sessionId}/messages`],
    staleTime: 120000,
  });

  if (isLoading) {
    return (
      <div className="px-4 pb-4 pt-2 border-t border-border/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading messages...
        </div>
      </div>
    );
  }

  if (!data || data.messages.length === 0) {
    return (
      <div className="px-4 pb-4 pt-2 border-t border-border/30">
        <p className="text-sm text-muted-foreground py-4 text-center">No messages found</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 pt-2 border-t border-border/30">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Conversation ({data.totalMessages} messages)
        </span>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-auto">
        {data.messages.map((msg, idx) => (
          <MessageRow key={idx} message={msg} />
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex items-start gap-2.5 text-xs rounded-md px-3 py-2 transition-colors hover:bg-accent/20 ${
        isUser
          ? "border-l-2 border-l-blue-500/50"
          : "border-l-2 border-l-green-500/50"
      }`}
    >
      {/* Role icon */}
      <div className="flex-shrink-0 mt-0.5">
        {isUser ? (
          <User className="h-3.5 w-3.5 text-blue-400" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-green-400" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-relaxed line-clamp-3 ${
          isUser ? "text-foreground" : "text-muted-foreground"
        }`}>
          {message.content || "(no content)"}
        </p>

        {/* Tool badges */}
        {message.hasToolUse && message.toolNames && message.toolNames.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <Wrench className="h-3 w-3 text-muted-foreground/50" />
            {message.toolNames.map((tool, i) => (
              <Badge
                key={i}
                variant="outline"
                className="text-[9px] px-1 py-0 text-muted-foreground/70 border-muted-foreground/20"
              >
                {tool}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Right metadata */}
      <div className="flex-shrink-0 text-right space-y-0.5">
        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums block">
          {formatTime(message.timestamp)}
        </span>
        {message.model && (
          <Badge variant="outline" className="text-[9px] px-1 py-0">
            {shortModel(message.model ?? null)}
          </Badge>
        )}
      </div>
    </div>
  );
}
