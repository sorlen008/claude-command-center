import type { Express } from "express";
import type { Server } from "http";
import entitiesRouter from "./entities";
import projectsRouter from "./projects";
import markdownRouter from "./markdown";
import graphRouter from "./graph";
import discoveryRouter from "./discovery";
import configRouter from "./config";
import scannerRouter from "./scanner";
import sessionsRouter from "./sessions";
import sessionAnalyticsRouter from "./session-analytics";
import sessionPromptsRouter from "./session-prompts";
import sessionWorkflowsRouter from "./session-workflows";
import agentsRouter from "./agents";
import liveRouter from "./live";
import updateRouter from "./update";
import settingsRouter from "./settings";
import customGraphRouter from "./custom-graph";
import aiSuggestRouter from "./ai-suggest";
import statsRouter from "./stats";
import exportRouter from "./export";
import costAnalyticsRouter from "./cost-analytics";
import burnAnalyticsRouter from "./burn-analytics";
import dashboardAnalyticsRouter from "./dashboard-analytics";
import planUsageRouter from "./plan-usage";
import apisRouter from "./apis";
import { spawn } from "child_process";
import { platform } from "os";
import path from "path";
import os from "os";
import { getRecentChanges } from "../scanner/watcher";

function openPath(p: string): void {
  // Validate path is under home directory to prevent opening arbitrary locations
  const resolved = path.resolve(p);
  const home = os.homedir();
  if (!resolved.startsWith(home + path.sep) && resolved !== home) {
    console.warn(`[openPath] Blocked path outside home: ${p}`);
    return;
  }
  const plat = platform();
  let child;
  if (plat === "win32") {
    child = spawn("explorer", [resolved.replace(/\//g, "\\")], { detached: true, stdio: "ignore" });
  } else if (plat === "darwin") {
    child = spawn("open", [resolved], { detached: true, stdio: "ignore" });
  } else {
    child = spawn("xdg-open", [resolved], { detached: true, stdio: "ignore" });
  }
  child.on("error", () => {}); // prevent unhandled error event crash
  child.unref();
}

export async function registerRoutes(server: Server, app: Express): Promise<void> {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/watcher/changes", (_req, res) => {
    res.json(getRecentChanges());
  });

  app.use(entitiesRouter);
  app.use(projectsRouter);
  app.use(markdownRouter);
  app.use(graphRouter);
  app.use(discoveryRouter);
  app.use(configRouter);
  app.use(scannerRouter);
  // Specific session sub-routers must mount BEFORE sessionsRouter
  // so their paths are matched before the /:id catch-all in sessions.ts
  app.use(sessionAnalyticsRouter);
  app.use(sessionPromptsRouter);
  app.use(sessionWorkflowsRouter);
  app.use(sessionsRouter);
  app.use(agentsRouter);
  app.use(liveRouter);
  app.use(updateRouter);
  app.use(settingsRouter);
  app.use(customGraphRouter);
  app.use(aiSuggestRouter);
  app.use(statsRouter);
  app.use(exportRouter);
  app.use(costAnalyticsRouter);
  app.use(burnAnalyticsRouter);
  app.use(dashboardAnalyticsRouter);
  app.use(planUsageRouter);
  app.use(apisRouter);

  // Actions — open-folder and open-file share identical logic
  const handleOpen = (req: import("express").Request, res: import("express").Response) => {
    const { path: targetPath } = req.body;
    if (!targetPath || typeof targetPath !== "string") return res.status(400).json({ message: "path required" });
    openPath(targetPath);
    res.json({ message: "Opening" });
  };
  app.post("/api/actions/open-folder", handleOpen);
  app.post("/api/actions/open-file", handleOpen);
}
