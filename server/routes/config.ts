import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import os from "os";
import path from "path";
import fs from "fs";

const router = Router();

const appVersion = (() => {
  try {
    const dir = typeof __dirname !== "undefined" ? __dirname : import.meta.dirname;
    const pkg = JSON.parse(fs.readFileSync(path.resolve(dir, "..", "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

router.get("/api/config/runtime", (_req: Request, res: Response) => {
  res.json({
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    homeDir: os.homedir().replace(/\\/g, "/"),
    claudeDir: path.join(os.homedir(), ".claude").replace(/\\/g, "/"),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    appVersion,
  });
});

router.get("/api/config/settings", (_req: Request, res: Response) => {
  const configs = storage.getEntities("config");
  res.json(configs);
});

export default router;
