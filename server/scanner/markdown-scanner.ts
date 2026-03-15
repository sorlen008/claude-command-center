import type { Entity } from "@shared/types";
import { entityId, safeReadText, getFileStat, HOME, CLAUDE_DIR, now, fileExists, dirExists, listFiles, discoverProjectDirs, listDirs } from "./utils";
import path from "path";
import fs from "fs";
import matter from "gray-matter";

type MarkdownCategory = "claude-md" | "memory" | "skill" | "readme" | "other";

function categorize(filePath: string, fileName: string): MarkdownCategory {
  if (fileName === "CLAUDE.md") return "claude-md";
  if (fileName === "SKILL.md") return "skill";
  if (fileName === "README.md") return "readme";
  if (filePath.includes("/memory/")) return "memory";
  return "other";
}

export function scanMarkdown(): Entity[] {
  const results: Entity[] = [];
  const seen = new Set<string>();

  function addMarkdownFile(filePath: string) {
    const normalized = filePath.replace(/\\/g, "/");
    if (seen.has(normalized)) return;
    seen.add(normalized);

    const stat = getFileStat(normalized);
    if (!stat) return;

    const content = safeReadText(normalized);
    if (content === null) return;

    const fileName = path.basename(normalized);
    const category = categorize(normalized, fileName);

    let frontmatter: Record<string, unknown> | null = null;
    try {
      const parsed = matter(content);
      if (Object.keys(parsed.data).length > 0) {
        frontmatter = parsed.data;
      }
    } catch {}

    const id = entityId(`markdown:${normalized}`);
    results.push({
      id,
      type: "markdown",
      name: fileName,
      path: normalized,
      description: `${category} file: ${normalized}`,
      lastModified: stat.mtime,
      tags: [category],
      health: "ok",
      data: {
        category,
        sizeBytes: stat.size,
        preview: content.slice(0, 300),
        frontmatter,
      },
      scannedAt: now(),
    });
  }

  // Root CLAUDE.md
  addMarkdownFile(path.join(HOME, "CLAUDE.md"));

  // All .md in ~/.claude/ (non-recursive)
  for (const f of listFiles(CLAUDE_DIR, ".md")) {
    addMarkdownFile(f);
  }

  // All .md in memory directories under ~/.claude/projects/*/memory/
  const projectsDir = path.join(CLAUDE_DIR, "projects").replace(/\\/g, "/");
  if (dirExists(projectsDir)) {
    try {
      const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const memDir = path.join(projectsDir, dir.name, "memory").replace(/\\/g, "/");
        if (dirExists(memDir)) {
          for (const f of listFiles(memDir, ".md")) {
            addMarkdownFile(f);
          }
        }
        // Project-level CLAUDE.md
        const projMd = path.join(projectsDir, dir.name, "CLAUDE.md").replace(/\\/g, "/");
        addMarkdownFile(projMd);
      }
    } catch {}
  }

  // Discovered project CLAUDE.md files
  for (const projDir of discoverProjectDirs()) {
    addMarkdownFile(path.join(projDir, "CLAUDE.md").replace(/\\/g, "/"));
    for (const sub of listDirs(projDir)) {
      addMarkdownFile(path.join(sub, "CLAUDE.md").replace(/\\/g, "/"));
    }
  }

  // SKILL.md files
  const skillsDir = path.join(CLAUDE_DIR, "skills").replace(/\\/g, "/");
  if (dirExists(skillsDir)) {
    try {
      const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const dir of skillDirs) {
        if (!dir.isDirectory()) continue;
        addMarkdownFile(path.join(skillsDir, dir.name, "SKILL.md").replace(/\\/g, "/"));
      }
    } catch {}
  }

  return results;
}
