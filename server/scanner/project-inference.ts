import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { HOME } from "./utils";

/**
 * Project inference — infer which project a session was actually working on,
 * based on which file paths it touched via Edit/Write/Read/NotebookEdit/Bash.
 * This is independent of the session's literal cwd (which may be the home dir).
 *
 * Result is cached on disk per-session keyed by file size, so we only re-scan
 * a session's JSONL when it has grown since last inference.
 */

export interface InferredProjectStats {
  project: string;
  weighted: number;
  files: number;
  edits: number;
  confidence: number;
  breakdown: Array<{ project: string; weighted: number }>;
}

const CACHE_DIR = process.env.COMMAND_CENTER_DATA
  ? path.resolve(process.env.COMMAND_CENTER_DATA)
  : path.join(os.homedir(), ".claude-command-center");
const CACHE_PATH = path.join(CACHE_DIR, "inferred-projects.json");
const CACHE_TMP = CACHE_PATH + ".tmp";

// Don't scan absurdly huge JSONL files — cap at 32MB or 50k lines per session.
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const MAX_SCAN_LINES = 50000;

// Confidence threshold: dominant share must be ≥ this, and total edits ≥ MIN_OPS.
const MIN_CONFIDENCE = 0.6;
const MIN_OPS = 3;

// Path-segment buckets that are config/system, not projects of their own.
// Anything matched here is collapsed into the "system" bucket.
const SYSTEM_BUCKETS = new Set([
  ".claude",
  ".claude-command-center",
  ".garminconnect",
  ".vscode",
  ".cursor",
  ".config",
  ".local",
  ".npm",
  ".cache",
  ".gitconfig",
]);

// Top-level segments to ignore entirely (noise, not work).
const IGNORE_SEGMENTS = new Set([
  "Desktop",
  "Documents",
  "Downloads",
  "Pictures",
  "Videos",
  "Music",
  "OneDrive",
  "AppData",
  "node_modules",
  "tmp",
  "Temp",
]);

/** Bump this when the inference algorithm changes (new buckets, weight tweaks,
 *  case-folding, etc.) — entries with a different version are treated as stale
 *  and re-scanned. */
const CACHE_VERSION = 2;

interface CacheEntry {
  fileSize: number;
  inferredProject: string | null;
  stats: InferredProjectStats | null;
  version?: number;
}

type Cache = Record<string, CacheEntry>;

let cache: Cache | null = null;
let cacheDirty = false;
let flushTimer: NodeJS.Timeout | null = null;

function loadCache(): Cache {
  if (cache) return cache;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const raw = fs.readFileSync(CACHE_PATH, "utf-8");
      cache = JSON.parse(raw) as Cache;
      return cache;
    }
  } catch (err) {
    console.warn("[project-inference] failed to load cache, starting fresh:", (err as Error).message);
  }
  cache = {};
  return cache;
}

function scheduleFlush(): void {
  cacheDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!cacheDirty || !cache) return;
    try {
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(CACHE_TMP, JSON.stringify(cache), "utf-8");
      fs.renameSync(CACHE_TMP, CACHE_PATH);
      cacheDirty = false;
    } catch (err) {
      console.warn("[project-inference] failed to flush cache:", (err as Error).message);
    }
  }, 500);
}

/**
 * Map an absolute or HOME-relative path to its project bucket.
 * Returns null if the path is outside HOME or should be ignored.
 */
function pathToProject(absPath: string): string | null {
  if (!absPath) return null;
  // Normalize slashes + try to strip HOME prefix
  const normalized = absPath.replace(/\\/g, "/");
  if (!normalized.toLowerCase().startsWith(HOME.toLowerCase())) {
    // Path outside HOME — could still be useful (e.g. C:\Program Files\...)
    // but for project attribution we only care about HOME-relative work.
    return null;
  }
  const rel = normalized.slice(HOME.length).replace(/^\/+/, "");
  if (!rel) return null;
  const segments = rel.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const top = segments[0];
  if (SYSTEM_BUCKETS.has(top)) return "system";
  if (IGNORE_SEGMENTS.has(top)) return null;
  // Treat top-level files (CLAUDE.md, MEMORY.md, etc) as "system" too — they're config.
  if (segments.length === 1) return "system";
  // Case-fold project names so "Nicora" and "nicora" don't split into two buckets.
  // Windows filesystems are case-insensitive in practice, but the recorded path
  // case depends on what the user typed at the prompt.
  return top.toLowerCase();
}

/**
 * Extract file paths from a tool_use record. Returns the path + a weight class:
 *  - "write" → Write, Edit, NotebookEdit, MultiEdit (high signal)
 *  - "read"  → Read (low signal)
 *  - "bash"  → Bash with cd <dir> commands (medium signal)
 */
function extractPathsFromToolUse(record: any): Array<{ path: string; weight: "write" | "read" | "bash" }> {
  const out: Array<{ path: string; weight: "write" | "read" | "bash" }> = [];
  try {
    const content = record?.message?.content;
    if (!Array.isArray(content)) return out;
    for (const block of content) {
      if (block?.type !== "tool_use") continue;
      const name: string = block.name || "";
      const input = block.input || {};
      if (name === "Edit" || name === "Write" || name === "NotebookEdit" || name === "MultiEdit") {
        const p = input.file_path || input.path;
        if (typeof p === "string") out.push({ path: p, weight: "write" });
      } else if (name === "Read") {
        const p = input.file_path || input.path;
        if (typeof p === "string") out.push({ path: p, weight: "read" });
      } else if (name === "Bash" || name === "PowerShell") {
        const cmd: string = input.command || "";
        // Pick up `cd <path>` and `<cmd> <path>` patterns lightly — only cd is reliable.
        const cdMatch = cmd.match(/\bcd\s+(?:\/d\s+)?["']?([A-Za-z]:[\\/][^"'\s&|;]+|\/[^"'\s&|;]+|~\/[^"'\s&|;]+)["']?/);
        if (cdMatch) {
          let p = cdMatch[1];
          if (p.startsWith("~/")) p = HOME + p.slice(1);
          out.push({ path: p, weight: "bash" });
        }
      }
    }
  } catch {
    // Malformed record — skip silently
  }
  return out;
}

const WEIGHTS = { write: 3, bash: 2, read: 1 } as const;

/**
 * Stream-parse a session JSONL and compute its inferred project.
 * Returns null if the session has too few file ops to infer confidently.
 */
async function computeInferred(filePath: string, fileSize: number): Promise<{ inferredProject: string | null; stats: InferredProjectStats | null }> {
  if (fileSize > MAX_SCAN_BYTES) {
    return { inferredProject: null, stats: null };
  }

  const projectScores = new Map<string, { weighted: number; edits: number; files: Set<string> }>();
  let linesRead = 0;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const finish = () => {
      if (resolved) return;
      resolved = true;
      try { rl.close(); } catch {}
      try { stream.destroy(); } catch {}
      resolve();
    };
    rl.on("line", (line) => {
      if (linesRead++ >= MAX_SCAN_LINES) { finish(); return; }
      const trimmed = line.trim();
      if (!trimmed) return;
      let record: any;
      try { record = JSON.parse(trimmed); } catch { return; }
      if (record?.type !== "assistant") return;  // tool_use lives in assistant messages
      const paths = extractPathsFromToolUse(record);
      for (const { path: p, weight } of paths) {
        const project = pathToProject(p);
        if (!project) continue;
        let bucket = projectScores.get(project);
        if (!bucket) {
          bucket = { weighted: 0, edits: 0, files: new Set() };
          projectScores.set(project, bucket);
        }
        bucket.weighted += WEIGHTS[weight];
        if (weight === "write") bucket.edits++;
        bucket.files.add(p);
      }
    });
    rl.on("close", finish);
    rl.on("error", finish);
    stream.on("error", finish);
  });

  if (projectScores.size === 0) return { inferredProject: null, stats: null };

  const sorted = Array.from(projectScores.entries())
    .map(([project, b]) => ({ project, weighted: b.weighted, edits: b.edits, files: b.files.size }))
    .sort((a, b) => b.weighted - a.weighted);

  const totalWeighted = sorted.reduce((s, e) => s + e.weighted, 0);
  const totalOps = sorted.reduce((s, e) => s + e.edits + (e.weighted - e.edits * WEIGHTS.write), 0);
  const top = sorted[0];
  const confidence = totalWeighted > 0 ? top.weighted / totalWeighted : 0;
  const totalFileOps = sorted.reduce((s, e) => s + e.files, 0);

  const stats: InferredProjectStats = {
    project: top.project,
    weighted: top.weighted,
    files: top.files,
    edits: top.edits,
    confidence,
    breakdown: sorted.slice(0, 5).map(({ project, weighted }) => ({ project, weighted })),
  };

  // Confidence + minimum activity gate
  if (confidence < MIN_CONFIDENCE || totalFileOps < MIN_OPS) {
    return { inferredProject: null, stats };
  }

  return { inferredProject: top.project, stats };
}

/**
 * Get the inferred project for a session, using cache when fresh.
 * Synchronous return — kicks off async computation on cache miss and
 * returns null until the next scan picks up the freshly-cached value.
 * This keeps the scanner non-blocking on first run while still being
 * fast on subsequent runs.
 */
export function getInferredProject(
  sessionId: string,
  filePath: string,
  fileSize: number,
): { inferredProject: string | null; stats: InferredProjectStats | null } {
  const c = loadCache();
  const cached = c[sessionId];
  const fresh = cached && cached.fileSize === fileSize && cached.version === CACHE_VERSION;
  if (fresh) {
    return { inferredProject: cached!.inferredProject, stats: cached!.stats };
  }
  // Async fire-and-forget: compute in background, persist for next scan.
  void computeInferred(filePath, fileSize).then((result) => {
    const cc = loadCache();
    cc[sessionId] = { fileSize, inferredProject: result.inferredProject, stats: result.stats, version: CACHE_VERSION };
    scheduleFlush();
  }).catch(() => {});
  // Return stale-or-empty so the current request stays fast.
  return cached
    ? { inferredProject: cached.inferredProject, stats: cached.stats }
    : { inferredProject: null, stats: null };
}

/**
 * Warm the cache synchronously for a batch of sessions — used on the first
 * call to scanAllSessions() to seed inference for everything at once.
 */
export async function warmInferenceCache(
  sessions: Array<{ id: string; filePath: string; sizeBytes: number }>,
): Promise<void> {
  const c = loadCache();
  const stale = sessions.filter(s => {
    const e = c[s.id];
    return !e || e.fileSize !== s.sizeBytes || e.version !== CACHE_VERSION;
  });
  if (stale.length === 0) return;
  // Parallelism cap of 4 to avoid pegging the disk
  const CONCURRENCY = 4;
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, stale.length) }, async () => {
    while (idx < stale.length) {
      const s = stale[idx++];
      try {
        const result = await computeInferred(s.filePath, s.sizeBytes);
        c[s.id] = { fileSize: s.sizeBytes, inferredProject: result.inferredProject, stats: result.stats, version: CACHE_VERSION };
      } catch {
        c[s.id] = { fileSize: s.sizeBytes, inferredProject: null, stats: null, version: CACHE_VERSION };
      }
    }
  });
  await Promise.all(workers);
  scheduleFlush();
}

/**
 * For tests: clear the in-memory cache so each test starts clean.
 * Doesn't touch the disk cache file.
 */
export function _resetCacheForTests(): void {
  cache = null;
  cacheDirty = false;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}
