import type { Entity } from "@shared/types";
import { entityId, safeReadText, getFileStat, CLAUDE_DIR, now, listDirs, fileExists } from "./utils";
import path from "path";
import matter from "gray-matter";

export function scanSkills(): Entity[] {
  const results: Entity[] = [];
  const skillsDir = path.join(CLAUDE_DIR, "skills").replace(/\\/g, "/");
  const skillDirs = listDirs(skillsDir);

  for (const skillDir of skillDirs) {
    const skillFile = path.join(skillDir, "SKILL.md").replace(/\\/g, "/");
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
