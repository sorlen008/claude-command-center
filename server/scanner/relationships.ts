import { storage } from "../storage";
import type { Entity } from "@shared/types";
import { decodeProjectKey } from "./utils";

/** Safely get a string property from entity data */
function getStr(entity: Entity, key: string): string {
  const val = entity.data[key];
  return typeof val === "string" ? val : "";
}

/** Safely get a string array property from entity data */
function getStrArr(entity: Entity, key: string): string[] {
  const val = entity.data[key];
  return Array.isArray(val) ? val.filter((v): v is string => typeof v === "string") : [];
}

/** Check if a file path belongs to a project (path-based ownership) */
function pathBelongsToProject(filePath: string, project: Entity): boolean {
  const projectPath = project.path;
  if (!projectPath) return false;
  return filePath.startsWith(projectPath + "/");
}

export function buildRelationships(
  projects: Entity[],
  mcps: Entity[],
  skills: Entity[],
  markdowns: Entity[],
  plugins: Entity[],
  scripts: Entity[] = []
): void {
  const projectByDir = new Map<string, Entity>();
  for (const p of projects) {
    const dirName = getStr(p, "dirName") || getStr(p, "projectKey");
    if (dirName) projectByDir.set(dirName, p);
  }

  // Track which entities get connected so we can link orphan MCPs/skills to all projects
  const connectedMcps = new Set<string>();
  const connectedSkills = new Set<string>();
  const connectedPlugins = new Set<string>();

  // === Project <-> MCP relationships ===
  for (const mcp of mcps) {
    const isPlugin = mcp.tags.includes("plugin");
    const sourceFile = getStr(mcp, "sourceFile");

    // MCP defined inside a project directory (e.g. project/.mcp.json)
    if (!isPlugin) {
      for (const project of projects) {
        if (pathBelongsToProject(sourceFile, project)) {
          storage.addRelationship({
            sourceId: project.id,
            sourceType: "project",
            targetId: mcp.id,
            targetType: "mcp",
            relation: "defines_mcp",
          });
          connectedMcps.add(mcp.id);
        }
      }
    }

    // Root-level MCPs (~/.mcp.json): infer project by matching command/args paths
    if (!isPlugin && !connectedMcps.has(mcp.id)) {
      const command = getStr(mcp, "command");
      const args = getStrArr(mcp, "args");
      const ref = `${command} ${args.join(" ")}`;
      for (const project of projects) {
        const dirName = getStr(project, "dirName");
        if (dirName && ref.includes(dirName)) {
          storage.addRelationship({
            sourceId: project.id,
            sourceType: "project",
            targetId: mcp.id,
            targetType: "mcp",
            relation: "uses_mcp",
          });
          connectedMcps.add(mcp.id);
        }
      }
    }

    // Plugin MCPs -> connect to plugin entity
    if (isPlugin) {
      const pluginName = mcp.description?.match(/plugin: (.+)\)$/)?.[1];
      if (pluginName) {
        const plugin = plugins.find(
          (p) => p.name === pluginName || p.path.includes(`/${pluginName}`)
        );
        if (plugin) {
          storage.addRelationship({
            sourceId: plugin.id,
            sourceType: "plugin",
            targetId: mcp.id,
            targetType: "mcp",
            relation: "provides_mcp",
          });
          connectedMcps.add(mcp.id);
          connectedPlugins.add(plugin.id);
        }
      }
    }
  }

  // Global MCPs (not connected to any project) are available to all projects
  for (const mcp of mcps) {
    if (!connectedMcps.has(mcp.id) && !mcp.tags.includes("plugin")) {
      for (const project of projects) {
        storage.addRelationship({
          sourceId: project.id,
          sourceType: "project",
          targetId: mcp.id,
          targetType: "mcp",
          relation: "uses_mcp",
        });
      }
      connectedMcps.add(mcp.id);
    }
  }

  // === Project <-> Skill relationships ===
  for (const skill of skills) {
    const skillPath = skill.path || "";

    // 1. Path-based: skill lives inside a project directory
    for (const project of projects) {
      if (pathBelongsToProject(skillPath, project)) {
        storage.addRelationship({
          sourceId: project.id,
          sourceType: "project",
          targetId: skill.id,
          targetType: "skill",
          relation: "has_skill",
        });
        skill.data.projectName = project.name;
        connectedSkills.add(skill.id);
      }
    }

    // 2. Content-based inference (fallback)
    if (!connectedSkills.has(skill.id)) {
      const content = getStr(skill, "content");
      for (const project of projects) {
        const dirName = getStr(project, "dirName");
        if (dirName && (content.includes(dirName) || content.includes(project.name))) {
          storage.addRelationship({
            sourceId: project.id,
            sourceType: "project",
            targetId: skill.id,
            targetType: "skill",
            relation: "has_skill",
          });
          skill.data.projectName = project.name;
          connectedSkills.add(skill.id);
        }
      }
    }
  }

  // === Plugin <-> Skill relationships (skills that live inside a plugin) ===
  // Match each skill to the most specific (deepest/longest path) plugin that contains it
  for (const skill of skills) {
    const skillPath = skill.path || "";
    if (!skillPath.includes("/plugins/")) continue;
    let bestPlugin: Entity | null = null;
    let bestLen = 0;
    for (const plugin of plugins) {
      if (plugin.path && skillPath.startsWith(plugin.path + "/") && plugin.path.length > bestLen) {
        bestPlugin = plugin;
        bestLen = plugin.path.length;
      }
    }
    if (bestPlugin) {
      storage.addRelationship({
        sourceId: bestPlugin.id,
        sourceType: "plugin",
        targetId: skill.id,
        targetType: "skill",
        relation: "has_skill",
      });
      connectedSkills.add(skill.id);
      connectedPlugins.add(bestPlugin.id);
    }
  }

  // === Project <-> Plugin relationships (installed plugins are globally available) ===
  for (const plugin of plugins) {
    // Skip marketplace container entities — only link actual plugins
    if (plugin.tags.includes("marketplace")) continue;
    for (const project of projects) {
      storage.addRelationship({
        sourceId: project.id,
        sourceType: "project",
        targetId: plugin.id,
        targetType: "plugin",
        relation: "uses",
      });
    }
    connectedPlugins.add(plugin.id);
  }

  // === Project <-> Markdown relationships ===
  for (const md of markdowns) {
    // CLAUDE.md files -> match by project directory
    if (md.name === "CLAUDE.md") {
      for (const project of projects) {
        const dirName = getStr(project, "dirName");
        if (dirName && md.path.includes(`/${dirName}/`)) {
          storage.addRelationship({
            sourceId: project.id,
            sourceType: "project",
            targetId: md.id,
            targetType: "markdown",
            relation: "has_claude_md",
          });
        }
      }
    }

    // Memory files -> link to project via decoded project key
    const category = getStr(md, "category");
    if (category === "memory" && md.path.includes("/memory/")) {
      const match = md.path.match(/\/projects\/([^/]+)\/memory\//);
      if (match) {
        const decoded = decodeProjectKey(match[1]);
        for (const project of projects) {
          if (decoded === project.path || decoded.startsWith(project.path + "/") || project.path.startsWith(decoded + "/")) {
            storage.addRelationship({
              sourceId: project.id,
              sourceType: "project",
              targetId: md.id,
              targetType: "markdown",
              relation: "has_memory",
            });
            break;
          }
        }
      }
    }

    // SKILL.md files -> link to matching skill
    if (md.name === "SKILL.md") {
      const skillDirName = md.path.split("/skills/")[1]?.split("/")[0];
      if (skillDirName) {
        const skill = skills.find((s) => s.name === skillDirName);
        if (skill) {
          storage.addRelationship({
            sourceId: skill.id,
            sourceType: "skill",
            targetId: md.id,
            targetType: "markdown",
            relation: "has_docs",
          });
        }
      }
    }
  }

  // === Project <-> Script relationships ===
  // Ownership is precomputed by the script scanner (deepest-project-wins),
  // so we just translate `data.projectId` into a relationship row.
  for (const script of scripts) {
    const projectId = getStr(script, "projectId");
    if (!projectId) continue;
    storage.addRelationship({
      sourceId: projectId,
      sourceType: "project",
      targetId: script.id,
      targetType: "script",
      relation: "contains_script",
    });
  }
}
