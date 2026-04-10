import fs from "fs";
import type { SessionData, SessionSummary, DeepSearchMatch, DeepSearchResult } from "@shared/types";
import { extractMessageText } from "./utils";

/** Extract ~200 char snippet centered on the match */
function extractSnippet(text: string, matchIndex: number, snippetLen = 200): string {
  const half = Math.floor(snippetLen / 2);
  let start = Math.max(0, matchIndex - half);
  let end = Math.min(text.length, matchIndex + half);
  // Adjust if we're near boundaries
  if (start === 0) end = Math.min(text.length, snippetLen);
  if (end === text.length) start = Math.max(0, text.length - snippetLen);
  let snippet = text.slice(start, end).replace(/\n/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

interface SearchMatch {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  lineIndex: number;
}

/** Check if all query words appear in the text. Returns index of first word match or -1. */
function fuzzyMatch(textLower: string, queryWords: string[]): number {
  for (const word of queryWords) {
    if (!textLower.includes(word)) return -1;
  }
  // Return index of first word for snippet extraction
  return textLower.indexOf(queryWords[0]);
}

/** Search a single session JSONL file for query matches */
function searchSessionFile(
  filePath: string,
  queryWords: string[],
  field: "all" | "user" | "assistant",
  maxMatches: number,
): SearchMatch[] {
  const matches: SearchMatch[] = [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let pos = 0;
    let lineIndex = 0;

    while (pos < content.length && matches.length < maxMatches) {
      const nextNewline = content.indexOf("\n", pos);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const trimmed = content.slice(pos, lineEnd).trim();
      pos = lineEnd + 1;

      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed);

        if (record.type === "user" && (field === "all" || field === "user")) {
          const msg = record.message;
          if (!msg || typeof msg !== "object") { lineIndex++; continue; }
          const text = extractMessageText(msg.content, true);
          if (text) {
            const idx = fuzzyMatch(text.toLowerCase(), queryWords);
            if (idx !== -1) {
              matches.push({
                role: "user",
                text: extractSnippet(text, idx),
                timestamp: record.timestamp || "",
                lineIndex,
              });
            }
          }
        } else if (record.type === "assistant" && (field === "all" || field === "assistant")) {
          const msg = record.message;
          if (!msg || typeof msg !== "object") { lineIndex++; continue; }
          const text = extractMessageText(msg.content, true);
          if (text) {
            const idx = fuzzyMatch(text.toLowerCase(), queryWords);
            if (idx !== -1) {
              matches.push({
                role: "assistant",
                text: extractSnippet(text, idx),
                timestamp: record.timestamp || "",
                lineIndex,
              });
            }
          }
        }
      } catch {
        // Malformed JSON line — skip
      }
      lineIndex++;
    }
  } catch {
    // File unreadable
  }

  return matches;
}

// Simple result cache
let cachedQuery = "";
let cachedResult: DeepSearchResult | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function deepSearch(params: {
  query: string;
  sessions: SessionData[];
  field?: "all" | "user" | "assistant";
  dateFrom?: string;
  dateTo?: string;
  project?: string;
  summaries?: Record<string, SessionSummary>;
  limit?: number;
}): Promise<DeepSearchResult> {
  const { query, sessions, field = "all", dateFrom, dateTo, project, summaries = {}, limit = 50 } = params;
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);

  // Check cache
  const cacheKey = JSON.stringify({ query: queryWords.join(" "), field, dateFrom, dateTo, project, limit });
  if (cachedQuery === cacheKey && cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  const start = performance.now();

  // Filter sessions by date range / project
  let filtered = sessions.filter(s => !s.isEmpty);
  if (dateFrom) filtered = filtered.filter(s => (s.lastTs || "") >= dateFrom);
  if (dateTo) filtered = filtered.filter(s => (s.firstTs || "") <= dateTo);
  if (project) {
    filtered = filtered.filter(s => s.projectKey.includes(project) || s.cwd.includes(project));
  }

  const totalSessions = sessions.length;
  const searchedSessions = filtered.length;

  // Process in parallel batches of 20
  const BATCH_SIZE = 20;
  const allResults: DeepSearchMatch[] = [];

  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (session) => {
        // Search in JSONL file
        const matches = searchSessionFile(session.filePath, queryWords, field, 10);

        // Also search summary text if available
        const summary = summaries[session.id];
        if (summary) {
          const summaryText = summary.summary;
          const idx = fuzzyMatch(summaryText.toLowerCase(), queryWords);
          if (idx !== -1 && matches.length < 10) {
            matches.push({
              role: "assistant" as const,
              text: "[Summary] " + extractSnippet(summaryText, idx),
              timestamp: summary.generatedAt,
              lineIndex: -1,
            });
          }
        }

        if (matches.length === 0) return null;

        return {
          sessionId: session.id,
          session,
          matches,
          matchCount: matches.length,
          summary,
        } satisfies DeepSearchMatch;
      }),
    );

    for (const r of batchResults) {
      if (r) allResults.push(r);
    }
  }

  // Rank: more matches first, then by recency
  allResults.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return (b.session.lastTs || "").localeCompare(a.session.lastTs || "");
  });

  const totalMatches = allResults.reduce((sum, r) => sum + r.matchCount, 0);
  const results = allResults.slice(0, limit);
  const durationMs = Math.round(performance.now() - start);

  const result: DeepSearchResult = {
    results,
    totalMatches,
    totalSessions,
    searchedSessions,
    durationMs,
  };

  // Cache the result
  cachedQuery = cacheKey;
  cachedResult = result;
  cachedAt = Date.now();

  return result;
}
