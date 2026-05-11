import chokidar from "chokidar";
import { HOME, CLAUDE_DIR, dirExists, discoverProjectDirs } from "./utils";
import { runFullScan, runPartialScan } from "./index";
import { getCachedSessions, getCachedStats } from "./session-scanner";
import { getCachedExecutions } from "./agent-scanner";
import { PERIODIC_SCAN_INTERVAL_MS, DEBOUNCE_MS } from "../config";
import path from "path";
import fs from "fs";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let changeLog: string[] = [];
let periodicTimer: ReturnType<typeof setInterval> | null = null;

// Track counts to detect meaningful changes during periodic refresh
let lastSessionCount = 0;
let lastActiveCount = 0;
let lastExecutionCount = 0;

export function getRecentChanges(): string[] {
  return changeLog.slice(-20);
}

/** Categorize a changed file path to determine which scanner to run */
function categorizePath(filePath: string): "mcp" | "skills" | "sessions" | "agents" | "plugins" | "config" | "markdown" | "full" {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.endsWith(".mcp.json")) return "mcp";
  if (normalized.includes("/skills/")) return "skills";
  if (normalized.includes("/agents/") && normalized.endsWith(".md")) return "agents";
  if (normalized.includes("/plugins/")) return "plugins";
  if (normalized.includes("/sessions/") && normalized.endsWith(".json")) return "sessions";
  if (normalized.endsWith("settings.json") || normalized.endsWith("settings.local.json")) return "config";
  if (normalized.endsWith("CLAUDE.md") || normalized.includes("/memory/")) return "markdown";
  return "full";
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

  // Active sessions directory (session start/end creates/removes .json files)
  const activeSessionsDir = path.join(CLAUDE_DIR, "sessions");
  if (dirExists(activeSessionsDir)) {
    watchPaths.push(activeSessionsDir);
  }

  // History file (updated when sessions are created)
  const historyFile = path.join(CLAUDE_DIR, "history.jsonl");
  if (fs.existsSync(historyFile)) {
    watchPaths.push(historyFile);
  }

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
      /command-center\.json$/,  // Don't watch our own DB file
      /[\/\\]plugins[\/\\]cache[\/\\]temp_/,  // Plugin git temp checkouts churn rapidly and trigger EPERM
    ],
  });

  // Chokidar's FSWatcher emits 'error' for transient OS issues (EPERM/ENOENT
  // when files vanish mid-watch). Without a listener these become uncaught
  // exceptions that crash the whole server. Log and swallow.
  watcher.on("error", (err) => {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "EPERM" || e?.code === "ENOENT") {
      console.warn(`[watcher] ignoring transient ${e.code}: ${e.path ?? e.message}`);
      return;
    }
    console.error("[watcher] error:", err);
  });

  const triggerRescan = (eventType: string, filePath: string) => {
    const relative = filePath.replace(HOME, "~").replace(/\\/g, "/");
    const entry = `${new Date().toISOString()} [${eventType}] ${relative}`;
    changeLog.push(entry);
    if (changeLog.length > 50) changeLog = changeLog.slice(-50);

    const category = categorizePath(filePath);
    console.log(`[watcher] ${eventType}: ${relative} → ${category} scan`);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        if (category === "full") {
          await runFullScan();
        } else {
          await runPartialScan(category);
        }
      } catch (err) {
        console.error("[watcher] Rescan failed:", err);
      }
    }, DEBOUNCE_MS);
  };

  // New files (including new .jsonl sessions) trigger a rescan
  watcher.on("add", (p) => triggerRescan("add", p));

  // Changes to existing session .jsonl files are too noisy (every message writes).
  // The periodic refresh below handles these. Other file changes trigger normally.
  watcher.on("change", (p) => {
    if (p.endsWith(".jsonl") && (p.includes("/projects/") || p.includes("\\projects\\"))) return;
    triggerRescan("change", p);
  });

  watcher.on("unlink", (p) => triggerRescan("unlink", p));
  watcher.on("addDir", (p) => {
    if (p.includes("/projects/") || p.includes("\\projects\\") ||
        p.includes("/skills/") || p.includes("\\skills\\")) {
      triggerRescan("addDir", p);
    }
  });

  console.log(`[watcher] Watching ${watchPaths.length} paths`);

  // Initialize tracking counts from current cache
  const stats = getCachedStats();
  lastSessionCount = stats.totalCount;
  lastActiveCount = stats.activeCount;
  lastExecutionCount = getCachedExecutions().length;

  // Start periodic refresh for session/agent data that changes frequently
  startPeriodicRefresh();
}

/**
 * Periodic full rescan every 30 seconds.
 *
 * Session .jsonl files update on every message — watching them would flood
 * the watcher with events. Instead, we rescan on a timer and only push
 * updates to the frontend when something actually changed (new sessions,
 * active status changes, new agent executions).
 */
function startPeriodicRefresh(): void {
  if (periodicTimer) clearInterval(periodicTimer);

  periodicTimer = setInterval(async () => {
    try {
      // Snapshot current counts before rescan
      const prevSessions = lastSessionCount;
      const prevActive = lastActiveCount;
      const prevExecutions = lastExecutionCount;

      // Full rescan — updates all caches and notifies frontend via SSE
      // runFullScan is a no-op if already scanning (prevents overlap)
      await runFullScan();

      // Update tracking counts from refreshed cache
      const stats = getCachedStats();
      lastSessionCount = stats.totalCount;
      lastActiveCount = stats.activeCount;
      lastExecutionCount = getCachedExecutions().length;

      // Log only when something changed
      if (lastSessionCount !== prevSessions ||
          lastActiveCount !== prevActive ||
          lastExecutionCount !== prevExecutions) {
        console.log(
          `[watcher] Periodic: sessions ${prevSessions}→${lastSessionCount}, ` +
          `active ${prevActive}→${lastActiveCount}, ` +
          `agents ${prevExecutions}→${lastExecutionCount}`
        );
      }
    } catch (err) {
      console.error("[watcher] Periodic refresh failed:", err);
    }
  }, PERIODIC_SCAN_INTERVAL_MS);
}
