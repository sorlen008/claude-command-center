import type { SessionData, ProjectDashboard, ProjectDashboardResult } from "@shared/types";
import { decodeProjectKey } from "./utils";
import { getCostAnalytics, getFileHeatmap, getHealthAnalytics } from "./session-analytics";
import { storage } from "../storage";

let cached: ProjectDashboardResult | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

export function getProjectDashboards(sessions: SessionData[]): ProjectDashboardResult {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;

  const start = performance.now();
  const costs = getCostAnalytics(sessions);
  const files = getFileHeatmap(sessions);
  const health = getHealthAnalytics(sessions);
  const summaries = storage.getSummaries();

  // Group sessions by project
  const byProject = new Map<string, SessionData[]>();
  for (const s of sessions) {
    const key = s.projectKey || "unknown";
    const arr = byProject.get(key) || [];
    arr.push(s);
    byProject.set(key, arr);
  }

  // Build health map by session ID
  const healthMap = new Map<string, string>();
  for (const h of health.sessions) {
    healthMap.set(h.sessionId, h.healthScore);
  }

  const projects: ProjectDashboard[] = [];

  byProject.forEach((projectSessions, projectKey) => {
    const projectPath = decodeProjectKey(projectKey);
    const projectCost = costs.byProject[projectKey];

    // Health breakdown for this project
    let good = 0, fair = 0, poor = 0;
    for (const s of projectSessions) {
      const score = healthMap.get(s.id) || "good";
      if (score === "poor") poor++;
      else if (score === "fair") fair++;
      else good++;
    }

    // Top files for this project
    const projectFiles = files.files
      .filter(f => f.sessions.some(sid => projectSessions.some(ps => ps.id === sid)))
      .slice(0, 5)
      .map(f => ({ fileName: f.fileName, touchCount: f.touchCount }));

    // Collect topics from summaries
    const topicsSet = new Set<string>();
    for (const s of projectSessions) {
      const summary = summaries[s.id];
      if (summary) {
        for (const t of summary.topics) topicsSet.add(t);
      }
    }

    // Recent sessions (top 5)
    const recent = projectSessions
      .sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""))
      .slice(0, 5)
      .map(s => ({
        id: s.id,
        firstMessage: (s.firstMessage || "").slice(0, 80),
        lastTs: s.lastTs || "",
        cost: projectCost ? Math.round(projectCost.cost / projectSessions.length * 10000) / 10000 : 0,
        hasSummary: !!summaries[s.id],
      }));

    projects.push({
      projectKey,
      projectPath,
      totalSessions: projectSessions.length,
      totalCost: projectCost?.cost || 0,
      totalTokens: projectCost?.tokens || 0,
      totalMessages: projectSessions.reduce((s, ps) => s + ps.messageCount, 0),
      totalSize: projectSessions.reduce((s, ps) => s + ps.sizeBytes, 0),
      healthBreakdown: { good, fair, poor },
      topFiles: projectFiles,
      recentSessions: recent,
      commits: 0,
      summaryTopics: Array.from(topicsSet).slice(0, 10),
    });
  });

  // Sort by cost (most expensive first)
  projects.sort((a, b) => b.totalCost - a.totalCost);

  const result: ProjectDashboardResult = {
    projects,
    durationMs: Math.round(performance.now() - start),
  };

  cached = result;
  cachedAt = Date.now();
  return result;
}
