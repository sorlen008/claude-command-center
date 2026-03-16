import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { MAX_JSONL_HEAD_CHUNK, MAX_JSONL_TAIL_CHUNK } from "../config";
import { getDB } from "../db";

/** Normalize a path to use forward slashes (cross-platform) */
export function normPath(...args: string[]): string {
  return path.join(...args).replace(/\\/g, "/");
}

export const HOME = os.homedir().replace(/\\/g, "/");
export const CLAUDE_DIR = normPath(HOME, ".claude");

export function entityId(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function safeReadJson(filePath: string): any | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function safeReadText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function getFileStat(filePath: string): { size: number; mtime: string } | null {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtime: stat.mtime.toISOString() };
  } catch {
    return null;
  }
}

export function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function listDirs(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dirPath, d.name).replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

export function listFiles(dirPath: string, ext?: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((d) => d.isFile() && (!ext || d.name.endsWith(ext)))
      .map((d) => path.join(dirPath, d.name).replace(/\\/g, "/"));
  } catch {
    return [];
  }
}

export function now(): string {
  return new Date().toISOString();
}

/** Discover project directories under HOME that have project markers */
export function discoverProjectDirs(): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(HOME, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(HOME, e.name).replace(/\\/g, "/");
      if (
        fileExists(path.join(full, "CLAUDE.md")) ||
        fileExists(path.join(full, ".mcp.json")) ||
        dirExists(path.join(full, ".git")) ||
        fileExists(path.join(full, "package.json")) ||
        fileExists(path.join(full, "pyproject.toml")) ||
        fileExists(path.join(full, "requirements.txt")) ||
        fileExists(path.join(full, "Cargo.toml")) ||
        fileExists(path.join(full, "go.mod"))
      ) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

/** Read first N JSON lines from file (reads only first chunk, not entire file).
 *  FD is properly closed in a finally block to prevent leaks. */
export function readHead(filePath: string, n: number = 25): any[] {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    const chunkSize = Math.min(MAX_JSONL_HEAD_CHUNK, stat.size);
    const buf = Buffer.alloc(chunkSize);
    fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, 0);
    const lines = buf.toString("utf-8").split("\n");
    const records: any[] = [];
    const limit = n * 3;
    for (let i = 0; i < Math.min(lines.length, limit); i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
        if (records.length >= n) break;
      } catch {
        // Truncated JSON line — skip
      }
    }
    return records;
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

/** Binary-seek last bytes of file to get last timestamp.
 *  FD is properly closed in a finally block to prevent leaks. */
export function readTailTs(filePath: string): string | null {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return null;
    const chunkSize = Math.min(MAX_JSONL_TAIL_CHUNK, stat.size);
    const buf = Buffer.alloc(chunkSize);
    fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, Math.max(0, stat.size - chunkSize));
    const lines = buf.toString("utf-8").split("\n").reverse();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const d = JSON.parse(trimmed);
        if (d.timestamp) return d.timestamp;
      } catch {
        // Truncated JSON line — skip
      }
    }
  } catch {
    // File unreadable
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return null;
}

/** Read the first chunk of a JSONL file and extract user/assistant message records.
 *  Returns up to 50 records from the first 128KB / 150 lines. */
export function readMessageTimeline(
  filePath: string,
  opts?: { includeModel?: boolean },
): { type: string; role?: string; timestamp: string; contentPreview: string; model?: string }[] {
  const records: { type: string; role?: string; timestamp: string; contentPreview: string; model?: string }[] = [];
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    const chunkSize = Math.min(131072, stat.size);
    const buf = Buffer.alloc(chunkSize);
    fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, chunkSize, 0);
    const lines = buf.toString("utf-8").split("\n");
    let count = 0;
    for (let i = 0; i < Math.min(lines.length, 150) && count < 50; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.type === "user" || r.type === "assistant") {
          const msg = r.message;
          let preview = "";
          if (msg && typeof msg === "object") {
            const c = msg.content;
            if (typeof c === "string") preview = c;
            else if (Array.isArray(c)) {
              preview = c.filter((x: any) => x?.type === "text").map((x: any) => x.text || "").join(" ");
            }
          }
          const record: { type: string; role?: string; timestamp: string; contentPreview: string; model?: string } = {
            type: r.type,
            role: msg?.role,
            timestamp: r.timestamp || "",
            contentPreview: preview.replace(/\n/g, " ").slice(0, 300),
          };
          if (opts?.includeModel && r.type === "assistant") {
            record.model = msg?.model;
          }
          records.push(record);
          count++;
        }
      } catch {
        // Truncated or malformed JSON line — skip
      }
    }
  } catch (err) {
    console.warn("[utils] Failed to read message timeline:", (err as Error).message);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return records;
}

/** Handle string and [{type:"text", text:"..."}] content shapes */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { type: string; text?: string } => item != null && typeof item === "object" && (item as Record<string, unknown>).type === "text")
      .map((item) => item.text || "")
      .join(" ");
  }
  return "";
}

/** Get extra scan paths from app settings */
export function getExtraPaths() {
  try {
    const settings = getDB().appSettings;
    return settings?.scanPaths || { extraMcpFiles: [], extraProjectDirs: [], extraSkillDirs: [], extraPluginDirs: [] };
  } catch {
    return { extraMcpFiles: [], extraProjectDirs: [], extraSkillDirs: [], extraPluginDirs: [] };
  }
}

/** Decode a Claude projects directory key to a filesystem path */
export function decodeProjectKey(key: string): string {
  // C--Users-alice -> C:/Users/alice (Windows)
  // -Users-hi -> /Users/hi (macOS/Linux, leading dash = leading /)
  const parts = key.split("--");
  if (parts.length === 1) {
    // No "--" means Unix path: -Users-hi -> /Users/hi
    return "/" + parts[0].replace(/^-/, "").replace(/-/g, "/");
  }
  // Windows: C--Users-alice -> C:/Users/alice
  let result = parts[0] + ":";
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i].replace(/-/g, "/");
    result += "/" + segment;
  }
  return result;
}
