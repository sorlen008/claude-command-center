import { execSync } from "child_process";
import type { SessionData, ContinuationBrief, ContinuationItem } from "@shared/types";
import { storage } from "../storage";

/** Detect sessions that likely need continuation */
export function getContinuationBrief(sessions: SessionData[]): ContinuationBrief {
  const summaries = storage.getSummaries();
  const SEVENTY_TWO_HOURS_AGO = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const candidates: ContinuationItem[] = [];

  for (const s of sessions) {
    if (s.isEmpty || s.messageCount < 3) continue;
    if ((s.lastTs || "") < SEVENTY_TWO_HOURS_AGO) continue;

    const summary = summaries[s.id];
    const outcome = summary?.outcome || "unknown";

    // Score based on indicators of unfinished work
    let score = 0;
    const lastFiles: string[] = [];

    // Non-completed outcome
    if (outcome === "abandoned") score += 3;
    else if (outcome === "ongoing") score += 2;
    else if (outcome === "error") score += 2;
    else if (outcome === "completed") continue; // Skip completed sessions

    // Feature branch (not main/master)
    if (s.gitBranch && s.gitBranch !== "main" && s.gitBranch !== "master" && s.gitBranch !== "HEAD") {
      score += 1;
    }

    // Check for uncommitted changes in cwd
    let uncommittedFiles = 0;
    if (s.cwd) {
      try {
        const status = execSync("git status --porcelain", {
          cwd: s.cwd, encoding: "utf-8", timeout: 3000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        uncommittedFiles = status.trim().split("\n").filter(l => l.trim()).length;
        if (uncommittedFiles > 0) score += 3;
      } catch {
        // Not a git repo or git not available
      }
    }

    // Collect files from summary
    if (summary?.filesModified) {
      lastFiles.push(...summary.filesModified.slice(0, 5));
    }

    if (score > 0) {
      candidates.push({
        sessionId: s.id,
        firstMessage: (s.firstMessage || "").slice(0, 100),
        lastTs: s.lastTs || "",
        outcome,
        summary: summary?.summary?.slice(0, 200),
        gitBranch: s.gitBranch || undefined,
        uncommittedFiles: uncommittedFiles || undefined,
        lastFiles,
        score,
      });
    }
  }

  // Sort by score descending, then by recency
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.lastTs.localeCompare(a.lastTs);
  });

  return {
    items: candidates.slice(0, 5),
    generatedAt: new Date().toISOString(),
  };
}
