import { Router, type Request, type Response } from "express";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { z } from "zod";
import type { UpdateStatus, UpdateApplyResult, UpdatePreferences } from "@shared/types";

const UpdatePrefsSchema = z.object({
  enabled: z.boolean().optional(),
  autoUpdate: z.boolean().optional(),
  dismissedCommit: z.string().nullable().optional(),
}).strict();

const router = Router();
const PROJECT_ROOT = path.resolve(
  typeof __dirname !== "undefined" ? __dirname : import.meta.dirname,
  "..", "..",
);

let cachedStatus: UpdateStatus | null = null;
let updateInProgress = false;

// Preferences file
const PREFS_PATH = path.join(PROJECT_ROOT, ".update-prefs.json");

function loadPrefs(): UpdatePreferences {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
  } catch {
    return { enabled: true, autoUpdate: false, dismissedCommit: null };
  }
}

function savePrefs(prefs: UpdatePreferences): void {
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}

function git(cmd: string, timeout = 15000): string {
  return (execSync(cmd, {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  }) as string).trim();
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function getCurrentCommit(): string {
  try {
    return git("git rev-parse --short HEAD");
  } catch {
    return "unknown";
  }
}

function detectRemoteBranch(): string {
  try {
    const ref = git("git symbolic-ref refs/remotes/origin/HEAD");
    return ref.replace("refs/remotes/", "");
  } catch {
    // Fallback: try origin/main, then origin/master
    try {
      git("git rev-parse origin/main");
      return "origin/main";
    } catch {
      try {
        git("git rev-parse origin/master");
        return "origin/master";
      } catch {
        return "origin/main";
      }
    }
  }
}

function isCacheFresh(): boolean {
  if (!cachedStatus?.lastCheckedAt) return false;
  const age = Date.now() - new Date(cachedStatus.lastCheckedAt).getTime();
  return age < 6 * 60 * 60 * 1000; // 6 hours
}

// GET /api/update/status — returns cached status + preferences
router.get("/api/update/status", (_req: Request, res: Response) => {
  const prefs = loadPrefs();

  if (cachedStatus && isCacheFresh()) {
    res.json({ ...cachedStatus, updateInProgress, prefs });
    return;
  }

  // Return placeholder — no blocking fetch
  res.json({
    updateAvailable: false,
    currentVersion: getVersion(),
    currentCommit: getCurrentCommit(),
    latestCommit: null,
    commitsBehind: 0,
    lastCheckedAt: cachedStatus?.lastCheckedAt || null,
    hasGitRemote: true,
    updateInProgress,
    error: null,
    prefs,
  });
});

// GET /api/update/prefs — get preferences
router.get("/api/update/prefs", (_req: Request, res: Response) => {
  res.json(loadPrefs());
});

// PATCH /api/update/prefs — update preferences
router.patch("/api/update/prefs", (req: Request, res: Response) => {
  const parsed = UpdatePrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join("; ") });
  }
  const current = loadPrefs();
  const updated = { ...current, ...parsed.data };
  savePrefs(updated);
  res.json(updated);
});

// POST /api/update/check — force fresh check
router.post("/api/update/check", (_req: Request, res: Response) => {
  const prefs = loadPrefs();

  if (!prefs.enabled) {
    res.json({
      updateAvailable: false,
      currentVersion: getVersion(),
      currentCommit: getCurrentCommit(),
      latestCommit: null,
      commitsBehind: 0,
      lastCheckedAt: null,
      hasGitRemote: true,
      updateInProgress,
      error: null,
      prefs,
    });
    return;
  }

  try {
    // Check for git remote
    try {
      git("git remote get-url origin");
    } catch {
      cachedStatus = {
        updateAvailable: false,
        currentVersion: getVersion(),
        currentCommit: getCurrentCommit(),
        latestCommit: null,
        commitsBehind: 0,
        lastCheckedAt: new Date().toISOString(),
        hasGitRemote: false,
        updateInProgress,
        error: null,
      };
      res.json({ ...cachedStatus, prefs });
      return;
    }

    // Fetch latest from remote
    try {
      git("git fetch origin --quiet", 30000);
    } catch (e: any) {
      // Network error — return cached + error
      const fallback: UpdateStatus = {
        updateAvailable: cachedStatus?.updateAvailable ?? false,
        currentVersion: cachedStatus?.currentVersion ?? getVersion(),
        currentCommit: cachedStatus?.currentCommit ?? getCurrentCommit(),
        latestCommit: cachedStatus?.latestCommit ?? null,
        commitsBehind: cachedStatus?.commitsBehind ?? 0,
        lastCheckedAt: cachedStatus?.lastCheckedAt ?? null,
        hasGitRemote: true,
        updateInProgress,
        error: `Failed to fetch: ${e.message?.split("\n")[0] || "network error"}`,
      };
      res.json({ ...fallback, prefs });
      return;
    }

    const remoteBranch = detectRemoteBranch();
    const currentCommit = git("git rev-parse --short HEAD");
    const latestCommit = git(`git rev-parse --short ${remoteBranch}`);
    const currentFull = git("git rev-parse HEAD");
    const latestFull = git(`git rev-parse ${remoteBranch}`);
    const commitsBehind = currentFull === latestFull
      ? 0
      : parseInt(git(`git rev-list --count HEAD..${remoteBranch}`), 10) || 0;

    cachedStatus = {
      updateAvailable: commitsBehind > 0,
      currentVersion: getVersion(),
      currentCommit,
      latestCommit,
      commitsBehind,
      lastCheckedAt: new Date().toISOString(),
      hasGitRemote: true,
      updateInProgress,
      error: null,
    };

    res.json({ ...cachedStatus, prefs });
  } catch (e: any) {
    res.status(500).json({
      updateAvailable: false,
      currentVersion: getVersion(),
      currentCommit: getCurrentCommit(),
      latestCommit: null,
      commitsBehind: 0,
      lastCheckedAt: new Date().toISOString(),
      hasGitRemote: true,
      updateInProgress,
      error: e.message || "Unknown error",
      prefs,
    });
  }
});

/** Detect if running from npm global install vs git clone */
function isNpmInstall(): boolean {
  // If there's no .git directory, it's an npm install
  try {
    fs.statSync(path.join(PROJECT_ROOT, ".git"));
    return false;
  } catch {
    return true;
  }
}

// POST /api/update/apply — run update steps based on install method
router.post("/api/update/apply", (_req: Request, res: Response) => {
  if (updateInProgress) {
    res.status(409).json({ error: "Update already in progress" });
    return;
  }

  updateInProgress = true;
  const steps: UpdateApplyResult["steps"] = [];
  let failed = false;

  const runStep = (name: string, cmd: string, timeout: number) => {
    if (failed) {
      steps.push({ name, status: "skipped", output: "" });
      return;
    }
    try {
      const output = execSync(cmd, {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      }) as string;
      steps.push({ name, status: "success", output: output.trim().slice(-500) });
    } catch (e: any) {
      failed = true;
      steps.push({ name, status: "failed", output: (e.stderr || e.message || "").trim().slice(-500) });
    }
  };

  try {
    if (isNpmInstall()) {
      // npm global install — update via npm
      runStep("npm update", "npm update -g claude-command-center", 120000);
    } else {
      // git clone — update via git pull + rebuild
      const remoteBranch = detectRemoteBranch();
      const branch = remoteBranch.replace("origin/", "");
      runStep("git pull", `git pull origin ${branch}`, 30000);
      runStep("npm install", "npm install", 120000);
      runStep("npm run build", "npm run build", 120000);
    }

    const success = !failed;
    if (success) {
      cachedStatus = null;
    }

    res.json({
      success,
      steps,
      restartRequired: success,
      error: failed ? `Step "${steps.find((s) => s.status === "failed")?.name}" failed` : null,
    } satisfies UpdateApplyResult);
  } finally {
    updateInProgress = false;
  }
});

export default router;
