import type { Entity } from "@shared/types";
import { entityId, safeReadText, getFileStat, CLAUDE_DIR, now, listDirs, fileExists, dirExists, getExtraPaths, discoverProjectDirs, normPath } from "./utils";
import path from "path";
import fs from "fs";
import matter from "gray-matter";

export function scanSkills(): Entity[] {
  const results: Entity[] = [];
  const seen = new Set<string>();
  const skillDirs: string[] = [];

  function addSkillDirs(parentDir: string) {
    for (const sub of listDirs(parentDir)) {
      if (!seen.has(sub)) {
        seen.add(sub);
        skillDirs.push(sub);
      }
    }
  }

  // 1. Global skills: ~/.claude/skills/
  addSkillDirs(normPath(CLAUDE_DIR, "skills"));

  // 2. Plugin skills: ~/.claude/plugins/marketplaces/*/plugins/*/skills/
  const marketplacesDir = normPath(CLAUDE_DIR, "plugins", "marketplaces");
  if (dirExists(marketplacesDir)) {
    for (const mktDir of listDirs(marketplacesDir)) {
      // Check both plugins/ subfolder and direct plugin dirs
      const pluginsSubDir = normPath(mktDir, "plugins");
      const searchDirs = dirExists(pluginsSubDir) ? [pluginsSubDir, mktDir] : [mktDir];
      for (const searchDir of searchDirs) {
        for (const pluginDir of listDirs(searchDir)) {
          const skillsInPlugin = normPath(pluginDir, "skills");
          if (dirExists(skillsInPlugin)) {
            addSkillDirs(skillsInPlugin);
          }
        }
      }
    }
    // Also check external_plugins within marketplaces
    for (const mktDir of listDirs(marketplacesDir)) {
      const extDir = normPath(mktDir, "external_plugins");
      if (dirExists(extDir)) {
        for (const pluginDir of listDirs(extDir)) {
          const skillsInPlugin = normPath(pluginDir, "skills");
          if (dirExists(skillsInPlugin)) {
            addSkillDirs(skillsInPlugin);
          }
        }
      }
    }
  }

  // 3. Project-local skills: <project>/.claude/skills/
  for (const projectDir of discoverProjectDirs()) {
    const projectSkillsDir = normPath(projectDir, ".claude", "skills");
    if (dirExists(projectSkillsDir)) {
      addSkillDirs(projectSkillsDir);
    }
  }

  // 4. Extra skill dirs from settings
  for (const extraDir of getExtraPaths().extraSkillDirs) {
    addSkillDirs(extraDir.replace(/\\/g, "/"));
  }

  for (const skillDir of skillDirs) {
    const skillFile = normPath(skillDir, "SKILL.md");
    if (!fileExists(skillFile)) continue;

    const content = safeReadText(skillFile);
    if (!content) continue;

    const stat = getFileStat(skillFile);
    const skillName = path.basename(skillDir);

    let frontmatter: Record<string, any> = {};
    let body = content;
    try {
      const parsed = matter(content);
      frontmatter = parsed.data;
      body = parsed.content;
    } catch {}

    const id = entityId(`skill:${skillFile}`);
    results.push({
      id,
      type: "skill",
      name: frontmatter.name || skillName,
      path: skillFile,
      description: frontmatter.description || null,
      lastModified: stat?.mtime ?? null,
      tags: frontmatter["user-invocable"] ? ["invocable"] : [],
      health: "ok",
      data: {
        userInvocable: frontmatter["user-invocable"] === true,
        args: frontmatter.args || null,
        content: body.trim().slice(0, 1500),
      },
      scannedAt: now(),
    });
  }

  return results;
}
