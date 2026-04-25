import fs from "fs";
import path from "path";
import type { Entity, ScriptEntity, ScriptLanguage } from "@shared/types";
import { entityId, normPath, now } from "./utils";

/** Directories we never descend into when looking for project-owned scripts. */
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  "out",
  ".cache",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  ".ruff_cache",
]);

const MAX_DEPTH = 6;
const MAX_PER_PROJECT = 200;
const DOCSTRING_READ_BYTES = 2048;
const MAX_FILE_SIZE_FOR_DOCSTRING = 1024 * 1024; // 1 MB

/**
 * Map of file extension → language. The script entity carries `language` so the
 * UI can render the right icon and so we can extend to other languages later
 * without a schema migration.
 */
const EXT_LANG: Record<string, ScriptLanguage> = {
  ".py": "python",
};

/**
 * Module-level docstring extractor.
 * Skips leading whitespace, comments, and `from __future__ import` lines, then
 * matches the first triple-quoted string. Returns the first non-empty trimmed
 * line of the docstring (single-line summary), capped at 200 chars.
 */
export function extractPythonDocstring(head: string): string | null {
  // Strip shebang if present.
  const noShebang = head.replace(/^#![^\n]*\n/, "");

  // Tolerate lines of comments, blank lines, and `from __future__` imports
  // before the docstring (PEP-257 says docstring should be first statement,
  // but __future__ imports are explicitly allowed before).
  const triple = noShebang.match(/(?:^[ \t]*#[^\n]*\n|^[ \t]*\n|^[ \t]*from\s+__future__[^\n]*\n)*[ \t]*(?:r|u|b|rb|br|R|U|B|RB|BR)?(?:"""|''')([\s\S]*?)(?:"""|''')/);
  if (!triple) return null;

  const raw = triple[1].trim();
  if (!raw) return null;

  // Take the first non-empty line.
  const firstLine = raw.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0);
  if (!firstLine) return null;

  return firstLine.length > 200 ? firstLine.slice(0, 197) + "…" : firstLine;
}

/**
 * Fallback: return the first non-comment, non-import, non-blank line.
 * Used when a script has no docstring — better than rendering an empty cell.
 */
export function firstMeaningfulLine(head: string): string | null {
  const noShebang = head.replace(/^#![^\n]*\n/, "");
  for (const rawLine of noShebang.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("from ") || line.startsWith("import ")) continue;
    return line.length > 200 ? line.slice(0, 197) + "…" : line;
  }
  return null;
}

interface ProjectIndex {
  /** ProjectEntity with its (already-normalized) path. */
  entity: Entity;
  pathWithSep: string;
}

/** Build a project lookup, sorted deepest path first so prefix-match wins the right project. */
function indexProjects(projects: Entity[]): ProjectIndex[] {
  return projects
    .filter(p => p.path)
    .map(p => ({ entity: p, pathWithSep: p.path.endsWith("/") ? p.path : p.path + "/" }))
    .sort((a, b) => b.pathWithSep.length - a.pathWithSep.length);
}

/** Recursively walk a directory, collecting absolute paths to .py (and future-language) files. */
function walkScripts(rootDir: string, out: string[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = normPath(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && !["bin", "scripts"].includes(entry.name.slice(1))) continue;
      walkScripts(full, out, depth + 1);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext in EXT_LANG) out.push(full);
    }
  }
}

interface ScanScriptsResult {
  scripts: ScriptEntity[];
  /** Map of projectId → number of scripts that belong to that project. Includes 0-counts so callers can clear stale chips. */
  countsByProject: Map<string, number>;
  /** ProjectIds whose walk hit the per-project cap. */
  cappedProjects: Set<string>;
}

/**
 * Scan project directory trees for source-code scripts.
 *
 * Ownership rule: a script belongs to the *deepest* project whose directory
 * contains it. This handles nested workspaces correctly — e.g. if the user
 * has a project at `~/work/` and a nested project at `~/work/sub/`, a script
 * at `~/work/sub/foo.py` is owned by `sub/`, not `work/`.
 */
export function scanScripts(projects: Entity[]): ScanScriptsResult {
  const projectIndex = indexProjects(projects);
  const scripts: ScriptEntity[] = [];
  const countsByProject = new Map<string, number>();
  const cappedProjects = new Set<string>();

  // Initialize counts for every project (so 0-counts are explicit).
  for (const p of projects) countsByProject.set(p.id, 0);

  // Walk each project root once. We can't share walks across nested projects:
  // the deepest-project rule means a single absolute path resolves to one project,
  // and we walk each project's full tree filtered by deepest ownership.
  for (const idx of projectIndex) {
    const projectPath = idx.entity.path;
    if (!projectPath) continue;

    let added = 0;
    const found: string[] = [];
    walkScripts(projectPath, found);
    for (const filePath of found) {
      // Resolve to deepest project — usually idx.entity, but a nested project
      // would shadow this one. Iterate the projectIndex (deepest first) and
      // pick whichever path is a prefix.
      const owner = projectIndex.find(pi => filePath === pi.pathWithSep.slice(0, -1) || filePath.startsWith(pi.pathWithSep));
      if (!owner) continue;
      // Only count this file once: when we hit it via the walk of its true owner.
      if (owner.entity.id !== idx.entity.id) continue;

      if (added >= MAX_PER_PROJECT) {
        cappedProjects.add(idx.entity.id);
        break;
      }

      const ext = path.extname(filePath).toLowerCase();
      const language = EXT_LANG[ext];
      if (!language) continue;

      const stat = (() => { try { return fs.statSync(filePath); } catch { return null; } })();
      if (!stat) continue;

      // Read head bytes for docstring extraction. Skip for very large files.
      let docstring: string | null = null;
      if (stat.size <= MAX_FILE_SIZE_FOR_DOCSTRING) {
        try {
          const fd = fs.openSync(filePath, "r");
          try {
            const buf = Buffer.alloc(Math.min(DOCSTRING_READ_BYTES, stat.size));
            fs.readSync(fd, buf, 0, buf.length, 0);
            const head = buf.toString("utf-8");
            docstring = extractPythonDocstring(head) || firstMeaningfulLine(head);
          } finally {
            fs.closeSync(fd);
          }
        } catch {
          // ignore; leave docstring null
        }
      }

      const relativePath = filePath.slice(idx.pathWithSep.length);

      scripts.push({
        id: entityId(`script:${filePath}`),
        type: "script",
        name: path.basename(filePath),
        path: filePath,
        description: docstring,
        lastModified: stat.mtime.toISOString(),
        tags: [language],
        health: "ok",
        scannedAt: now(),
        data: {
          language,
          projectId: idx.entity.id,
          relativePath,
          docstring,
          sizeBytes: stat.size,
        },
      });

      added += 1;
      countsByProject.set(idx.entity.id, (countsByProject.get(idx.entity.id) || 0) + 1);
    }
  }

  return { scripts, countsByProject, cappedProjects };
}
