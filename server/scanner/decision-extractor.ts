import fs from "fs";
import crypto from "crypto";
import type { SessionData, Decision } from "@shared/types";
import { storage } from "../storage";
import { extractMessageText } from "./utils";
import { runClaude, parseClaudeJson } from "./claude-runner";

/** Extract conversation context for decision mining */
function extractConversation(filePath: string): string[] {
  const parts: string[] = [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    let pos = 0;
    while (pos < content.length && parts.length < 40) {
      const nextNewline = content.indexOf("\n", pos);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const trimmed = content.slice(pos, lineEnd).trim();
      pos = lineEnd + 1;
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);
        if (record.type === "user") {
          const text = extractMessageText(record.message?.content, true);
          if (text) parts.push(`USER: ${text.slice(0, 300)}`);
        } else if (record.type === "assistant") {
          const text = extractMessageText(record.message?.content, true);
          if (text) parts.push(`ASSISTANT: ${text.slice(0, 300)}`);
        }
      } catch {}
    }
  } catch {}
  return parts;
}

/** Run claude -p to extract decisions from a session */
export async function extractDecisions(session: SessionData): Promise<Decision[]> {
  if (session.isEmpty || session.messageCount < 10) return [];

  const conversation = extractConversation(session.filePath);
  if (conversation.length < 6) return [];

  const prompt = `Extract significant technical decisions from this Claude Code session. Only extract decisions where trade-offs were explicitly discussed or alternatives were considered.

Conversation:
${conversation.join("\n")}

Return a JSON array. Each item:
{"topic":"what was decided","alternatives":["option1","option2"],"chosen":"what was selected and why","tradeOffs":"downsides accepted","tags":["keyword1","keyword2"]}

If no significant decisions were made, return []. Only return the JSON array, nothing else.`;

  const answer = await runClaude(prompt, { model: "haiku", timeoutMs: 60000 });
  const parsed = parseClaudeJson(answer);

  try {
    if (!Array.isArray(parsed)) return [];

    const decisions: Decision[] = [];
    for (const raw of parsed) {
      const item = raw as Record<string, unknown>;
      if (!item || typeof item.topic !== "string") continue;
      decisions.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        timestamp: session.lastTs || new Date().toISOString(),
        topic: String(item.topic).slice(0, 200),
        alternatives: Array.isArray(item.alternatives) ? (item.alternatives as unknown[]).map(String).slice(0, 10) : [],
        chosen: String(item.chosen || "").slice(0, 500),
        tradeOffs: String(item.tradeOffs || "").slice(0, 500),
        project: session.projectKey,
        tags: Array.isArray(item.tags) ? (item.tags as unknown[]).map(String).slice(0, 10) : [],
      });
    }

    // Store in DB
    for (const d of decisions) {
      storage.addDecision(d);
    }

    return decisions;
  } catch {
    return [];
  }
}
