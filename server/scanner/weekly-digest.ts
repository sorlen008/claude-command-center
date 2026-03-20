import type { SessionData, WeeklyDigest } from "@shared/types";
import { getCostAnalytics, getFileHeatmap, getHealthAnalytics } from "./session-analytics";
import { storage } from "../storage";

export function generateWeeklyDigest(sessions: SessionData[]): WeeklyDigest {
  const now = new Date();
  const weekEnd = now.toISOString().slice(0, 10);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Filter sessions from this week
  const weekSessions = sessions.filter(s => {
    const ts = (s.lastTs || s.firstTs || "").slice(0, 10);
    return ts >= weekStart && ts <= weekEnd;
  });

  const costs = getCostAnalytics(sessions);
  const files = getFileHeatmap(sessions);
  const health = getHealthAnalytics(sessions);
  const summaries = storage.getSummaries();

  // Cost for this week only
  const weekDays = costs.byDay.filter(d => d.date >= weekStart && d.date <= weekEnd);
  const weekCost = weekDays.reduce((s, d) => s + d.cost, 0);
  const weekTokens = weekDays.reduce((s, d) => s + d.tokens, 0);

  // Project breakdown for this week
  const byProject = new Map<string, { sessions: number; cost: number }>();
  for (const s of weekSessions) {
    const key = s.projectKey || "unknown";
    const existing = byProject.get(key) || { sessions: 0, cost: 0 };
    existing.sessions++;
    byProject.set(key, existing);
  }
  // Calculate weekly cost per project from daily data
  for (const day of weekDays) {
    // byDay doesn't have per-project breakdown, so distribute proportionally
    // based on session count per project this week
  }
  // Use weekly cost proportional to session count
  const totalWeekSessions = weekSessions.length || 1;
  byProject.forEach((data) => {
    data.cost = Math.round(weekCost * (data.sessions / totalWeekSessions) * 10000) / 10000;
  });
  const projectBreakdown = Array.from(byProject.entries())
    .map(([project, data]) => ({ project, ...data }))
    .sort((a, b) => b.cost - a.cost);

  // Top accomplishments from summaries
  const accomplishments: string[] = [];
  for (const s of weekSessions) {
    const summary = summaries[s.id];
    if (summary && summary.outcome === "completed") {
      accomplishments.push(summary.summary.slice(0, 120));
    }
  }

  // Health for this week's sessions
  const weekHealth = { good: 0, fair: 0, poor: 0 };
  const healthMap = new Map<string, string>();
  for (const h of health.sessions) healthMap.set(h.sessionId, h.healthScore);
  for (const s of weekSessions) {
    const score = healthMap.get(s.id) || "good";
    if (score === "poor") weekHealth.poor++;
    else if (score === "fair") weekHealth.fair++;
    else weekHealth.good++;
  }

  return {
    weekStart,
    weekEnd,
    totalSessions: weekSessions.length,
    totalCost: Math.round(weekCost * 10000) / 10000,
    totalTokens: weekTokens,
    projectBreakdown,
    topAccomplishments: accomplishments.slice(0, 10),
    topFiles: files.files.slice(0, 10).map(f => ({ fileName: f.fileName, touchCount: f.touchCount })),
    healthSummary: weekHealth,
  };
}
