import type { Entity } from "@shared/types";
import { entityId, safeReadText, getFileStat, HOME, CLAUDE_DIR, now, fileExists, dirExists, listFiles, discoverProjectDirs, listDirs, normPath } from "./utils";
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

    // For SKILL.md, use the parent directory name as the display name
    // e.g. ~/.claude/skills/automation/SKILL.md → "automation"
    let displayName = fileName;
    if (category === "skill") {
      const parentDir = path.basename(path.dirname(normalized));
      displayName = parentDir.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }

    let frontmatter: Record<string, unknown> | null = null;
    try {
      const parsed = matter(content);
      if (Object.keys(parsed.data).length > 0) {
        frontmatter = parsed.data;
      }
    } catch {}

    // Extract markdown links to other .md files
    const links: string[] = [];
    const linkRegex = /\[(?:[^\]]*)\]\(([^)]+\.md)\)/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(content)) !== null) {
      const target = linkMatch[1];
      if (!target.startsWith("http://") && !target.startsWith("https://")) {
        links.push(target);
      }
    }

    const id = entityId(`markdown:${normalized}`);
    results.push({
      id,
      type: "markdown",
      name: displayName,
      path: normalized,
      description: `${category} file: ${normalized}`,
      lastModified: stat.mtime,
      tags: [category],
      health: "ok",
      data: {
        category,
        sizeBytes: stat.size,
        lineCount: content.split("\n").length,
        preview: content.slice(0, 300),
        frontmatter,
        links: links.length > 0 ? links : undefined,
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
  const projectsDir = normPath(CLAUDE_DIR, "projects");
  if (dirExists(projectsDir)) {
    try {
      const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const memDir = normPath(projectsDir, dir.name, "memory");
        if (dirExists(memDir)) {
          for (const f of listFiles(memDir, ".md")) {
            addMarkdownFile(f);
          }
        }
        // Project-level CLAUDE.md
        const projMd = normPath(projectsDir, dir.name, "CLAUDE.md");
        addMarkdownFile(projMd);
      }
    } catch {}
  }

  // Discovered project CLAUDE.md files
  for (const projDir of discoverProjectDirs()) {
    addMarkdownFile(normPath(projDir, "CLAUDE.md"));
    for (const sub of listDirs(projDir)) {
      addMarkdownFile(normPath(sub, "CLAUDE.md"));
    }
  }

  // SKILL.md files — global skills
  const skillsDir = normPath(CLAUDE_DIR, "skills");
  if (dirExists(skillsDir)) {
    try {
      const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const dir of skillDirs) {
        if (!dir.isDirectory()) continue;
        addMarkdownFile(normPath(skillsDir, dir.name, "SKILL.md"));
      }
    } catch {}
  }

  // SKILL.md files — project-local skills (<project>/.claude/skills/*/SKILL.md)
  for (const projDir of discoverProjectDirs()) {
    const projSkillsDir = normPath(projDir, ".claude", "skills");
    if (dirExists(projSkillsDir)) {
      try {
        const dirs = fs.readdirSync(projSkillsDir, { withFileTypes: true });
        for (const dir of dirs) {
          if (!dir.isDirectory()) continue;
          addMarkdownFile(normPath(projSkillsDir, dir.name, "SKILL.md"));
        }
      } catch {}
    }
  }

  // SKILL.md files — plugin skills
  const marketplacesDir = normPath(CLAUDE_DIR, "plugins", "marketplaces");
  if (dirExists(marketplacesDir)) {
    try {
      // Recursively find all SKILL.md files under marketplaces
      const findSkillMds = (dir: string) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            const full = normPath(dir, entry.name);
            if (entry.isFile() && entry.name === "SKILL.md") {
              addMarkdownFile(full);
            } else if (entry.isDirectory()) {
              findSkillMds(full);
            }
          }
        } catch {}
      };
      findSkillMds(marketplacesDir);
    } catch {}
  }

  return results;
}
