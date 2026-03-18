import fs from "fs";
import type { SessionData, SessionDiff, SessionDiffsResult } from "@shared/types";

/** Extract Write/Edit operations from a session JSONL file */
export function getSessionDiffs(session: SessionData): SessionDiffsResult {
  const diffs: SessionDiff[] = [];

  try {
    const content = fs.readFileSync(session.filePath, "utf-8");
    let pos = 0;

    while (pos < content.length) {
      const nextNewline = content.indexOf("\n", pos);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const trimmed = content.slice(pos, lineEnd).trim();
      pos = lineEnd + 1;
      if (!trimmed) continue;

      try {
        const record = JSON.parse(trimmed);
        if (record.type !== "assistant") continue;

        const msg = record.message;
        if (!msg || !Array.isArray(msg.content)) continue;
        const ts = record.timestamp || "";

        for (const item of msg.content) {
          if (item == null || typeof item !== "object" || item.type !== "tool_use") continue;
          const toolName = (item.name || "") as string;
          const input = item.input as Record<string, unknown> | undefined;
          if (!input) continue;

          if (toolName === "Write" || toolName === "write") {
            const fp = (input.file_path || input.path || "") as string;
            if (fp) {
              diffs.push({
                tool: "Write",
                filePath: fp,
                timestamp: ts,
                content: typeof input.content === "string" ? input.content.slice(0, 2000) : undefined,
              });
            }
          } else if (toolName === "Edit" || toolName === "edit") {
            const fp = (input.file_path || "") as string;
            if (fp) {
              diffs.push({
                tool: "Edit",
                filePath: fp,
                timestamp: ts,
                oldString: typeof input.old_string === "string" ? input.old_string.slice(0, 1000) : undefined,
                newString: typeof input.new_string === "string" ? input.new_string.slice(0, 1000) : undefined,
              });
            }
          }
        }
      } catch {
        // Malformed line
      }
    }
  } catch {
    // Unreadable file
  }

  return {
    sessionId: session.id,
    diffs,
    totalDiffs: diffs.length,
  };
}
