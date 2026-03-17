import { execSync } from "child_process";
import type { SessionData, CommitLink } from "@shared/types";

/** Find git commits that overlap with a session's time window and working directory */
export function getSessionCommits(session: SessionData): CommitLink[] {
  if (!session.cwd || !session.firstTs || !session.lastTs) return [];

  try {
    // Add 5 min buffer on each side to catch commits made just before/after
    const after = new Date(new Date(session.firstTs).getTime() - 5 * 60 * 1000).toISOString();
    const before = new Date(new Date(session.lastTs).getTime() + 5 * 60 * 1000).toISOString();

    const result = execSync(
      `git log --after="${after}" --before="${before}" --format="%H|||%s|||%ai|||%N" --shortstat`,
      { cwd: session.cwd, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
    );

    const commits: CommitLink[] = [];
    const lines = result.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }

      if (line.includes("|||")) {
        const parts = line.split("|||");
        if (parts.length >= 3) {
          const hash = parts[0].trim();
          const message = parts[1].trim();
          const timestamp = parts[2].trim();

          // Next non-empty line might be shortstat
          let filesChanged = 0;
          const nextLine = (lines[i + 1] || "").trim();
          if (nextLine) {
            // Skip empty line between format and shortstat
            const statLine = nextLine.match(/(\d+) file/) ? nextLine : (lines[i + 2] || "").trim();
            const fileMatch = statLine.match(/(\d+) file/);
            if (fileMatch) {
              filesChanged = parseInt(fileMatch[1], 10);
              i += statLine === nextLine ? 1 : 2;
            }
          }

          commits.push({ hash, message, timestamp, filesChanged });
        }
      }
      i++;
    }

    return commits;
  } catch {
    return [];
  }
}
