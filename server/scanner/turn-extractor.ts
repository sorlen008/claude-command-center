import { createReadStream } from "fs";
import { createInterface } from "readline";

// Shared single-pass JSONL extractor. Every analytics module that needs per-turn
// data should call extractTurns() instead of reimplementing the readline loop.

export interface RawToolUse {
  name: string;
  input: Record<string, unknown>;
}

export interface RawTurn {
  ts: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  toolUses: RawToolUse[];
}

export interface RawErrorEvent {
  ts: string;
  text: string;
}

/**
 * Rate-limit event Anthropic wrote into the JSONL when Claude Code got throttled.
 * Identified by `record.type === "assistant" && record.error === "rate_limit" &&
 * record.isApiErrorMessage === true`. The text typically reads
 * `"You've hit your limit · resets <time> (<tz>)"`.
 */
export interface RateLimitEvent {
  ts: string;
  resetText: string;       // e.g. "12am (America/Los_Angeles)"
  fullMessage: string;     // raw content text
}

export interface ExtractResult {
  turns: RawTurn[];
  errors: RawErrorEvent[];
  rateLimitEvents: RateLimitEvent[];
  firstUserMessage: string;
  isSidechain: boolean;
  entrypoint: string;
}

function toolResultErrorText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
      const t = (c as { text?: string }).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join(" ");
}

/** Mutable accumulator for a single pass over a session's JSONL lines. */
interface TurnAccumulator {
  turns: RawTurn[];
  errors: RawErrorEvent[];
  rateLimitEvents: RateLimitEvent[];
  firstUserMessage: string;
  isSidechain: boolean;
  entrypoint: string;
  sawFirstRecord: boolean;
}

function newAccumulator(): TurnAccumulator {
  return { turns: [], errors: [], rateLimitEvents: [], firstUserMessage: "", isSidechain: false, entrypoint: "", sawFirstRecord: false };
}

function toResult(acc: TurnAccumulator): ExtractResult {
  return {
    turns: acc.turns,
    errors: acc.errors,
    rateLimitEvents: acc.rateLimitEvents,
    firstUserMessage: acc.firstUserMessage,
    isSidechain: acc.isSidechain,
    entrypoint: acc.entrypoint,
  };
}

/** Fold one JSONL line into the accumulator. Shared by the streaming
 *  (extractTurns) and in-memory (extractTurnsFromString) entry points so the
 *  per-record parsing lives in exactly one place. */
function processLine(line: string, acc: TurnAccumulator): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const record = JSON.parse(trimmed);

    if (!acc.sawFirstRecord) {
      if (record.isSidechain === true) acc.isSidechain = true;
      if (typeof record.entrypoint === "string") acc.entrypoint = record.entrypoint;
      acc.sawFirstRecord = true;
    }

    const ts = typeof record.timestamp === "string" ? record.timestamp : "";

    if (record.type === "assistant") {
      const msg = record.message;
      if (!msg || typeof msg !== "object") return;

      // Detect Anthropic-written rate-limit errors (synthetic assistant message).
      if (record.error === "rate_limit" && record.isApiErrorMessage === true) {
        const content = msg.content;
        let fullText = "";
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
              const t = (item as { text?: string }).text;
              if (typeof t === "string") fullText += t;
            }
          }
        }
        // Extract the "resets X (tz)" phrase from `You've hit your limit · resets 12am (America/Los_Angeles)`
        const match = fullText.match(/resets?\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?\s*\([^)]+\))/i);
        acc.rateLimitEvents.push({
          ts,
          resetText: match ? match[1] : "",
          fullMessage: fullText.slice(0, 300),
        });
        // Synthetic rate-limit messages always have zero usage; do not count as a turn.
        return;
      }

      const usage = msg.usage;
      const model = typeof msg.model === "string" ? msg.model : "unknown";
      const toolUses: RawToolUse[] = [];
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item && typeof item === "object" && item.type === "tool_use") {
            toolUses.push({
              name: typeof item.name === "string" ? item.name : "",
              input: (item.input && typeof item.input === "object") ? item.input as Record<string, unknown> : {},
            });
          }
        }
      }
      if (!usage && toolUses.length === 0) return;
      acc.turns.push({
        ts,
        model,
        inputTokens: usage?.input_tokens || 0,
        outputTokens: usage?.output_tokens || 0,
        cacheReadTokens: usage?.cache_read_input_tokens || 0,
        cacheCreationTokens: usage?.cache_creation_input_tokens || 0,
        toolUses,
      });
    } else if (record.type === "user") {
      const msg = record.message;
      if (!msg || typeof msg !== "object") return;
      const content = msg.content;

      if (!acc.firstUserMessage) {
        if (typeof content === "string") {
          acc.firstUserMessage = content.slice(0, 500);
        } else if (Array.isArray(content)) {
          const textBits: string[] = [];
          for (const item of content) {
            if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
              const t = (item as { text?: string }).text;
              if (typeof t === "string") textBits.push(t);
            }
          }
          if (textBits.length > 0) acc.firstUserMessage = textBits.join(" ").slice(0, 500);
        }
      }

      if (Array.isArray(content)) {
        for (const item of content) {
          if (item && typeof item === "object" && item.type === "tool_result" && item.is_error === true) {
            const text = toolResultErrorText(item.content).slice(0, 500);
            acc.errors.push({ ts, text });
          }
        }
      }
    }
  } catch {
    // malformed line; skip
  }
}

/** Streaming single-pass extractor over a session JSONL file. */
export function extractTurns(filePath: string): Promise<ExtractResult> {
  return new Promise((resolve) => {
    const acc = newAccumulator();
    try {
      const stream = createReadStream(filePath, { encoding: "utf-8" });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      rl.on("line", (line: string) => processLine(line, acc));
      rl.on("close", () => resolve(toResult(acc)));
      rl.on("error", () => resolve(toResult(acc)));
      stream.on("error", () => {
        rl.close();
        resolve(toResult(acc));
      });
    } catch {
      resolve(toResult(acc));
    }
  });
}

/** In-memory variant for callers that already hold the file contents (or need a
 *  synchronous call). Same per-record logic as extractTurns. */
export function extractTurnsFromString(content: string): ExtractResult {
  const acc = newAccumulator();
  for (const line of content.split("\n")) processLine(line, acc);
  return toResult(acc);
}

/**
 * Detect whether a session was triggered by automation rather than an interactive user.
 * Heuristic: first user message starts with a slash-command, an XML task tag, or specific
 * automation preamble strings.
 */
export function classifyOrigin(firstUserMessage: string): "interactive" | "hook" | "subagent" {
  const m = (firstUserMessage || "").trim();
  if (!m) return "interactive";
  if (/^\[Task\]|^<task[>\s]/i.test(m)) return "subagent";
  if (/^<(tool_call|local-command)/i.test(m)) return "hook";
  return "interactive";
}
