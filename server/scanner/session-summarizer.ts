import fs from "fs";
import type { SessionData, SessionSummary } from "@shared/types";
import { storage } from "../storage";
import { extractMessageText, extractToolNames } from "./utils";
import { runClaude, parseClaudeJson } from "./claude-runner";

/** Extract file paths from Write/Edit tool inputs */
function extractFilePaths(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const paths: string[] = [];
  for (const item of content) {
    if (item != null && typeof item === "object" && item.type === "tool_use") {
      const input = item.input as Record<string, unknown> | undefined;
      if (input) {
        const fp = input.file_path || input.path;
        if (typeof fp === "string" && !paths.includes(fp)) {
          paths.push(fp);
        }
      }
    }
  }
  return paths;
}

interface SessionContext {
  userMessages: string[];
  assistantMessages: string[];
  toolNames: string[];
  filePaths: string[];
}

/** Stream JSONL and extract context for summarization */
function extractSessionContext(filePath: string): SessionContext {
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  const toolNamesSet = new Set<string>();
  const filePathsSet = new Set<string>();

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let pos = 0;

    while (pos < content.length) {
      const nextNewline = content.indexOf("\n", pos);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const trimmed = content.slice(pos, lineEnd).trim();
      pos = lineEnd + 1;

      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed);

        if (record.type === "user" && userMessages.length < 30) {
          const msg = record.message;
          if (!msg || typeof msg !== "object") continue;
          const text = extractMessageText(msg.content, true);
          if (text) userMessages.push(text.slice(0, 300));
        } else if (record.type === "assistant" && assistantMessages.length < 30) {
          const msg = record.message;
          if (!msg || typeof msg !== "object") continue;
          const text = extractMessageText(msg.content, true);
          if (text) assistantMessages.push(text.slice(0, 300));

          for (const name of extractToolNames(msg.content)) toolNamesSet.add(name);
          for (const fp of extractFilePaths(msg.content)) filePathsSet.add(fp);
        }
      } catch {
        // Malformed JSON line — skip
      }
    }
  } catch {
    // File unreadable
  }

  return {
    userMessages,
    assistantMessages,
    toolNames: Array.from(toolNamesSet),
    filePaths: Array.from(filePathsSet),
  };
}

// runClaude and parseClaudeJson imported from ./claude-runner

// Concurrency limiter: max 2 concurrent Haiku calls
let activeCount = 0;
const waitQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeCount < 2) {
    activeCount++;
    return;
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeCount++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeCount--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next();
  }
}

/** Summarize a single session */
export async function summarizeSession(session: SessionData): Promise<SessionSummary> {
  const ctx = extractSessionContext(session.filePath);

  if (ctx.userMessages.length === 0 && ctx.assistantMessages.length === 0) {
    throw new Error("Session has no message content to summarize");
  }

  const conversationParts: string[] = [];
  const maxParts = Math.max(ctx.userMessages.length, ctx.assistantMessages.length);
  for (let i = 0; i < maxParts && conversationParts.length < 40; i++) {
    if (i < ctx.userMessages.length) {
      conversationParts.push(`USER: ${ctx.userMessages[i]}`);
    }
    if (i < ctx.assistantMessages.length) {
      conversationParts.push(`ASSISTANT: ${ctx.assistantMessages[i]}`);
    }
  }

  const prompt = `Analyze this Claude Code session and return a JSON object. Do NOT include any text outside the JSON.

Session ID: ${session.id}
Slug: ${session.slug}
Messages: ${session.messageCount}
Tools used: ${ctx.toolNames.join(", ") || "none"}
Files touched: ${ctx.filePaths.slice(0, 20).join(", ") || "none"}

Conversation (truncated):
${conversationParts.join("\n")}

Return this exact JSON format:
{
  "summary": "One paragraph describing what was accomplished in this session",
  "topics": ["topic1", "topic2", "topic3"],
  "outcome": "completed|abandoned|ongoing|error",
  "toolsUsed": ["tool1", "tool2"],
  "filesModified": ["file1", "file2"]
}

Rules:
- summary: 1-2 sentences, focus on what was done and why
- topics: 2-5 keywords describing the main themes
- outcome: "completed" if task was finished, "abandoned" if user stopped early, "ongoing" if session seems active, "error" if it ended with errors
- toolsUsed: list the main tools (Read, Edit, Write, Bash, etc.)
- filesModified: list key files that were created or modified (max 10)`;

  await acquireSlot();
  try {
    const raw = await runClaude(prompt, { model: "haiku", timeoutMs: 5 * 60 * 1000 });
    const rawParsed = parseClaudeJson(raw);
    const parsed = rawParsed && !Array.isArray(rawParsed) ? rawParsed : null;

    if (!parsed || typeof parsed.summary !== "string") {
      throw new Error("Failed to parse Claude response as valid summary JSON");
    }

    const summary: SessionSummary = {
      sessionId: session.id,
      summary: (parsed.summary as string).slice(0, 1000),
      topics: Array.isArray(parsed.topics) ? (parsed.topics as string[]).slice(0, 10).map(String) : [],
      toolsUsed: Array.isArray(parsed.toolsUsed) ? (parsed.toolsUsed as string[]).slice(0, 20).map(String) : ctx.toolNames.slice(0, 20),
      outcome: (["completed", "abandoned", "ongoing", "error"].includes(parsed.outcome as string)
        ? parsed.outcome : "completed") as SessionSummary["outcome"],
      filesModified: Array.isArray(parsed.filesModified) ? (parsed.filesModified as string[]).slice(0, 10).map(String) : ctx.filePaths.slice(0, 10),
      generatedAt: new Date().toISOString(),
      model: "haiku",
    };

    storage.upsertSummary(summary);
    return summary;
  } finally {
    releaseSlot();
  }
}

/** Summarize a batch of sessions (newest first, up to batchSize) */
export async function summarizeBatch(
  sessions: SessionData[],
  batchSize = 10,
): Promise<{ summarized: string[]; failed: string[]; skipped: string[] }> {
  // Filter to unsummarized, non-empty sessions
  const allIds = sessions.map(s => s.id);
  const unsummarized = storage.getUnsummarizedSessionIds(allIds);
  const unsummarizedSet = new Set(unsummarized);

  const candidates = sessions
    .filter(s => !s.isEmpty && unsummarizedSet.has(s.id) && s.messageCount > 0)
    .sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""))
    .slice(0, batchSize);

  const summarized: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  // Process with concurrency limiter (max 2 in parallel via acquireSlot)
  const promises = candidates.map(async (session) => {
    try {
      await summarizeSession(session);
      summarized.push(session.id);
    } catch (err) {
      console.error(`[summarizer] Failed to summarize ${session.id}:`, (err as Error).message);
      failed.push(session.id);
    }
  });

  await Promise.all(promises);

  // Sessions that were already summarized
  const processedSet = new Set([...summarized, ...failed]);
  for (const id of allIds) {
    if (!unsummarizedSet.has(id) && !processedSet.has(id)) {
      // Already had summary — not counted
    }
  }

  return { summarized, failed, skipped };
}
