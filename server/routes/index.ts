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
import agentsRouter from "./agents";
import liveRouter from "./live";
import updateRouter from "./update";
import { exec } from "child_process";
import { platform } from "os";
import { getRecentChanges } from "../scanner/watcher";

function openPath(p: string): void {
  const escaped = p.replace(/"/g, '\\"');
  const plat = platform();
  if (plat === "win32") exec(`start "" "${escaped.replace(/\//g, "\\\\")}"`);
  else if (plat === "darwin") exec(`open "${escaped}"`);
  else exec(`xdg-open "${escaped}"`);
}

export async function registerRoutes(server: Server, app: Express): Promise<void> {
  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Watcher change log
  app.get("/api/watcher/changes", (_req, res) => {
    res.json(getRecentChanges());
  });

  // Register all route modules
  app.use(entitiesRouter);
  app.use(projectsRouter);
  app.use(markdownRouter);
  app.use(graphRouter);
  app.use(discoveryRouter);
  app.use(configRouter);
  app.use(scannerRouter);
  app.use(sessionsRouter);
  app.use(agentsRouter);
  app.use(liveRouter);
  app.use(updateRouter);

  // Actions
  app.post("/api/actions/open-folder", (req, res) => {
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ message: "path required" });
    openPath(folderPath);
    res.json({ message: "Opening folder" });
  });

  app.post("/api/actions/open-file", (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ message: "path required" });
    openPath(filePath);
    res.json({ message: "Opening file" });
  });
}
