import fs from "fs";
import type { SessionData, FileTimelineEntry, FileTimelineResult } from "@shared/types";

/** Build a timeline of all changes to a specific file across all sessions */
export function getFileTimeline(sessions: SessionData[], targetPath: string): FileTimelineResult {
  const entries: FileTimelineEntry[] = [];
  const sessionIds = new Set<string>();

  // Normalize for comparison
  const targetNorm = targetPath.replace(/\\/g, "/").toLowerCase();

  for (const session of sessions) {
    if (session.isEmpty) continue;

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

            const fp = ((input.file_path || input.path || "") as string).replace(/\\/g, "/").toLowerCase();
            // Exact path match or exact filename match at end of path (with separator)
            if (!fp || (fp !== targetNorm && !fp.endsWith("/" + targetNorm))) continue;

            if (toolName === "Write" || toolName === "write") {
              sessionIds.add(session.id);
              entries.push({
                sessionId: session.id,
                firstMessage: (session.firstMessage || "").slice(0, 80),
                lastTs: session.lastTs || "",
                tool: "Write",
                timestamp: ts,
                content: typeof input.content === "string" ? input.content.slice(0, 500) : undefined,
              });
            } else if (toolName === "Edit" || toolName === "edit") {
              sessionIds.add(session.id);
              entries.push({
                sessionId: session.id,
                firstMessage: (session.firstMessage || "").slice(0, 80),
                lastTs: session.lastTs || "",
                tool: "Edit",
                timestamp: ts,
                oldString: typeof input.old_string === "string" ? input.old_string.slice(0, 500) : undefined,
                newString: typeof input.new_string === "string" ? input.new_string.slice(0, 500) : undefined,
              });
            }
          }
        } catch {
          // Malformed line
        }
      }
    } catch {
      // Unreadable file
    }
  }

  // Sort by timestamp (newest first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    filePath: targetPath,
    entries: entries.slice(0, 100),
    totalSessions: sessionIds.size,
  };
}
