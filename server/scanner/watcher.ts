import chokidar from "chokidar";
import { HOME, CLAUDE_DIR, dirExists, discoverProjectDirs } from "./utils";
import { runFullScan } from "./index";
import path from "path";
import fs from "fs";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let changeLog: string[] = [];

export function getRecentChanges(): string[] {
  return changeLog.slice(-20);
}

export function startWatcher(): void {
  const watchPaths: string[] = [];

  // Root config files
  watchPaths.push(path.join(HOME, ".mcp.json"));
  watchPaths.push(path.join(HOME, "CLAUDE.md"));
  watchPaths.push(path.join(CLAUDE_DIR, "settings.json"));
  watchPaths.push(path.join(CLAUDE_DIR, "settings.local.json"));

  // Skills directory (new skills, modified SKILL.md)
  watchPaths.push(path.join(CLAUDE_DIR, "skills"));

  // Plugins directory (blocklist changes, new marketplaces)
  watchPaths.push(path.join(CLAUDE_DIR, "plugins"));

  // User agents directory
  watchPaths.push(path.join(CLAUDE_DIR, "agents"));

  // Memory directories for all projects
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  if (dirExists(projectsDir)) {
    try {
      const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const memoryDir = path.join(projectsDir, dir.name, "memory");
        if (dirExists(memoryDir)) {
          watchPaths.push(memoryDir);
        }
      }
    } catch {}
  }

  // Discovered project directories — watch for CLAUDE.md and .mcp.json changes
  for (const projDir of discoverProjectDirs()) {
    const claudeMd = path.join(projDir, "CLAUDE.md");
    const mcpJson = path.join(projDir, ".mcp.json");
    if (fs.existsSync(claudeMd)) watchPaths.push(claudeMd);
    if (fs.existsSync(mcpJson)) watchPaths.push(mcpJson);
  }

  // Watch for new project directories appearing
  watchPaths.push(projectsDir);

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    persistent: true,
    depth: 3,
    awaitWriteFinish: { stabilityThreshold: 1000 },
    ignored: [
      /node_modules/,
      /\.git/,
      /\.jsonl$/,
      /command-center\.json$/,  // Don't watch our own DB file
    ],
  });

  const triggerRescan = (eventType: string, filePath: string) => {
    const relative = filePath.replace(HOME, "~").replace(/\\/g, "/");
    const entry = `${new Date().toISOString()} [${eventType}] ${relative}`;
    changeLog.push(entry);
    if (changeLog.length > 50) changeLog = changeLog.slice(-50);

    console.log(`[watcher] ${eventType}: ${relative}`);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log("[watcher] Changes detected, rescanning...");
      runFullScan().catch((err) => console.error("[watcher] Rescan failed:", err));
    }, 2000);
  };

  watcher.on("add", (p) => triggerRescan("add", p));
  watcher.on("change", (p) => triggerRescan("change", p));
  watcher.on("unlink", (p) => triggerRescan("unlink", p));
  watcher.on("addDir", (p) => {
    // New project directory or memory directory
    if (p.includes("/projects/") || p.includes("/skills/")) {
      triggerRescan("addDir", p);
    }
  });

  console.log(`[watcher] Watching ${watchPaths.length} paths`);
}
