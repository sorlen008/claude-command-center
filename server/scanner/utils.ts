import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

export const HOME = os.homedir().replace(/\\/g, "/");
export const CLAUDE_DIR = path.join(HOME, ".claude").replace(/\\/g, "/");

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
        (dirExists(path.join(full, ".git")) && fileExists(path.join(full, "package.json")))
      ) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

/** Decode a Claude projects directory key to a filesystem path */
export function decodeProjectKey(key: string): string {
  // C--Users-zwin0 -> C:/Users/zwin0 (Windows)
  // -Users-hi -> /Users/hi (macOS/Linux, leading dash = leading /)
  const parts = key.split("--");
  if (parts.length === 1) {
    // No "--" means Unix path: -Users-hi -> /Users/hi
    return "/" + parts[0].replace(/^-/, "").replace(/-/g, "/");
  }
  // Windows: C--Users-zwin0 -> C:/Users/zwin0
  let result = parts[0] + ":";
  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i].replace(/-/g, "/");
    result += "/" + segment;
  }
  return result;
}
