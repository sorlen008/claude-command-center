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

export function extractTurns(filePath: string): Promise<ExtractResult> {
  return new Promise((resolve) => {
    const turns: RawTurn[] = [];
    const errors: RawErrorEvent[] = [];
    const rateLimitEvents: RateLimitEvent[] = [];
    let firstUserMessage = "";
    let isSidechain = false;
    let entrypoint = "";
    let sawFirstRecord = false;

    try {
      const stream = createReadStream(filePath, { encoding: "utf-8" });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on("line", (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const record = JSON.parse(trimmed);

          if (!sawFirstRecord) {
            if (record.isSidechain === true) isSidechain = true;
            if (typeof record.entrypoint === "string") entrypoint = record.entrypoint;
            sawFirstRecord = true;
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
              rateLimitEvents.push({
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
            turns.push({
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

            if (!firstUserMessage) {
              if (typeof content === "string") {
                firstUserMessage = content.slice(0, 500);
              } else if (Array.isArray(content)) {
                const textBits: string[] = [];
                for (const item of content) {
                  if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
                    const t = (item as { text?: string }).text;
                    if (typeof t === "string") textBits.push(t);
                  }
                }
                if (textBits.length > 0) firstUserMessage = textBits.join(" ").slice(0, 500);
              }
            }

            if (Array.isArray(content)) {
              for (const item of content) {
                if (item && typeof item === "object" && item.type === "tool_result" && item.is_error === true) {
                  const text = toolResultErrorText(item.content).slice(0, 500);
                  errors.push({ ts, text });
                }
              }
            }
          }
        } catch {
          // malformed line; skip
        }
      });

      rl.on("close", () => resolve({ turns, errors, rateLimitEvents, firstUserMessage, isSidechain, entrypoint }));
      rl.on("error", () => resolve({ turns, errors, rateLimitEvents, firstUserMessage, isSidechain, entrypoint }));
      stream.on("error", () => {
        rl.close();
        resolve({ turns, errors, rateLimitEvents, firstUserMessage, isSidechain, entrypoint });
      });
    } catch {
      resolve({ turns, errors, rateLimitEvents, firstUserMessage, isSidechain, entrypoint });
    }
  });
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
