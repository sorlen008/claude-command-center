import http from "http";
import type { SessionData, NerveCenterData, ServiceStatus } from "@shared/types";
import { getCostAnalytics, getFileHeatmap } from "./session-analytics";

/** Check if a local service is up by attempting HTTP connection */
function checkService(name: string, port: number): Promise<ServiceStatus> {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request({ hostname: "127.0.0.1", port, method: "GET", path: "/", timeout: 2000 }, (res) => {
      res.resume();
      resolve({ name, port, status: "up", responseMs: Date.now() - start });
    });
    req.on("error", () => resolve({ name, port, status: "down" }));
    req.on("timeout", () => { req.destroy(); resolve({ name, port, status: "down" }); });
    req.end();
  });
}

/** Detect files with high edit counts across sessions that may have uncommitted changes */
function getUncommittedWork(sessions: SessionData[]): Array<{ filePath: string; sessionCount: number; editCount: number }> {
  const files = getFileHeatmap(sessions);
  // Files with many edits across many sessions are candidates for uncommitted work
  return files.files
    .filter(f => f.operations.edit > 5 && f.sessionCount > 1)
    .slice(0, 10)
    .map(f => ({
      filePath: f.fileName,
      sessionCount: f.sessionCount,
      editCount: f.operations.edit,
    }));
}

/** Build attention items from analytics */
function buildAttentionItems(sessions: SessionData[]): Array<{ severity: "info" | "warning" | "critical"; message: string }> {
  const items: Array<{ severity: "info" | "warning" | "critical"; message: string }> = [];
  const costs = getCostAnalytics(sessions);

  // Cost pacing
  const days = costs.byDay;
  if (days.length >= 7) {
    const lastWeek = days.slice(-7);
    const prevWeek = days.slice(-14, -7);
    const lastWeekCost = lastWeek.reduce((s, d) => s + d.cost, 0);
    const prevWeekCost = prevWeek.reduce((s, d) => s + d.cost, 0);
    if (prevWeekCost > 0 && lastWeekCost > prevWeekCost * 1.2) {
      const pct = Math.round((lastWeekCost / prevWeekCost - 1) * 100);
      items.push({ severity: "warning", message: `Spending is ${pct}% higher than last week ($${lastWeekCost.toFixed(2)} vs $${prevWeekCost.toFixed(2)})` });
    }
  }

  // Stale/empty sessions
  const empty = sessions.filter(s => s.isEmpty).length;
  if (empty > 10) {
    items.push({ severity: "info", message: `${empty} empty sessions could be cleaned up` });
  }

  // High-churn files
  const heatmap = getFileHeatmap(sessions);
  const hotFiles = heatmap.files.filter(f => f.touchCount > 30);
  if (hotFiles.length > 0) {
    items.push({ severity: "info", message: `${hotFiles.length} files edited 30+ times — consider refactoring: ${hotFiles.map(f => f.fileName).join(", ")}` });
  }

  return items;
}

let cached: NerveCenterData | null = null;
let cachedAt = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds for nerve center

export async function getNerveCenterData(sessions: SessionData[]): Promise<NerveCenterData> {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;

  // Check services in parallel — configurable via NERVE_CENTER_SERVICES env var
  // Format: "name:port,name:port" e.g. "My App:3000,Database:5432"
  const defaultServices = [{ name: "Command Center", port: 5100 }];
  const envServices = process.env.NERVE_CENTER_SERVICES;
  const serviceList = envServices
    ? envServices.split(",").map(s => {
        const [name, portStr] = s.trim().split(":");
        return { name: name.trim(), port: parseInt(portStr, 10) };
      }).filter(s => s.name && !isNaN(s.port))
    : defaultServices;

  const services = await Promise.all(
    serviceList.map(s => checkService(s.name, s.port))
  );

  const costs = getCostAnalytics(sessions);
  const days = costs.byDay;
  const thisWeek = days.slice(-7).reduce((s, d) => s + d.cost, 0);
  const prevWeeks = days.slice(-28, -7);
  const avgWeek = prevWeeks.length >= 7 ? prevWeeks.reduce((s, d) => s + d.cost, 0) / Math.ceil(prevWeeks.length / 7) : thisWeek;

  const uncommitted = getUncommittedWork(sessions);
  const attention = buildAttentionItems(sessions);

  // Overnight activity (last 12 hours of sessions)
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const overnightSessions = sessions.filter(s => (s.lastTs || "") > twelveHoursAgo && !s.isEmpty);
  const overnight = overnightSessions.map(s => `${(s.firstMessage || s.slug || "").slice(0, 60)} (${s.messageCount} msgs)`);

  // Service health attention items
  for (const svc of services) {
    if (svc.status === "down") {
      attention.push({ severity: svc.name === "Brave CDP" ? "info" : "warning", message: `${svc.name} (:${svc.port}) is down` });
    }
  }

  cached = {
    services,
    costPacing: {
      thisWeek: Math.round(thisWeek * 100) / 100,
      avgWeek: Math.round(avgWeek * 100) / 100,
      pacingPct: avgWeek > 0 ? Math.round((thisWeek / avgWeek) * 100) : 100,
    },
    uncommittedWork: uncommitted,
    overnightActivity: overnight.slice(0, 10),
    attentionItems: attention,
    generatedAt: new Date().toISOString(),
  };
  cachedAt = Date.now();

  return cached;
}
