import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { entityId } from "../scanner/utils";
import { openTerminalInDir } from "../scanner/session-delegation";
import fs from "fs";
import path from "path";
import os from "os";

const router = Router();

router.get("/api/projects", (_req: Request, res: Response) => {
  const projects = storage.getEntities("project");

  const enriched = projects.map((project) => {
    const rels = storage.getRelationships(project.id);
    const mcpCount = rels.filter((r) => r.targetType === "mcp" || r.sourceType === "mcp").length;
    const skillCount = rels.filter((r) => r.targetType === "skill" || r.sourceType === "skill").length;
    const markdownCount = rels.filter((r) => r.targetType === "markdown" || r.sourceType === "markdown").length;
    return { ...project, mcpCount, skillCount, markdownCount };
  });

  res.json(enriched);
});

router.get("/api/projects/rules", (_req: Request, res: Response) => {
  const projects = storage.getEntities("project");

  // Read global settings once (same for all projects)
  let globalSettings: object | null = null;
  try {
    const globalSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
    globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, "utf-8"));
  } catch {
    globalSettings = null;
  }

  // Read global hooks once
  let globalHooks: object | null = null;
  try {
    const globalHooksPath = path.join(os.homedir(), ".claude", "hooks.json");
    globalHooks = JSON.parse(fs.readFileSync(globalHooksPath, "utf-8"));
  } catch {
    globalHooks = null;
  }

  // Read global MCP servers (from ~/.mcp.json and ~/.claude/settings.json mcpServers)
  let globalMcp: Record<string, any> | null = null;
  try {
    const globalMcpPath = path.join(os.homedir(), ".mcp.json");
    globalMcp = JSON.parse(fs.readFileSync(globalMcpPath, "utf-8"));
  } catch {
    globalMcp = null;
  }
  // Also merge mcpServers from global settings
  if (globalSettings && typeof globalSettings === "object" && "mcpServers" in globalSettings) {
    const settingsMcps = (globalSettings as any).mcpServers;
    if (settingsMcps && typeof settingsMcps === "object") {
      globalMcp = { ...(globalMcp || {}), ...settingsMcps };
    }
  }

  const result = projects.map((project) => {
    const projectPath = (project as any).path as string;

    // 1. CLAUDE.md content
    let claudeMd: string | null = null;
    let claudeMdId: string | null = null;
    const claudeMdPath = path.join(projectPath, "CLAUDE.md").replace(/\\/g, "/");
    try {
      claudeMd = fs.readFileSync(claudeMdPath, "utf-8");
      claudeMdId = entityId(`markdown:${claudeMdPath}`);
    } catch {
      claudeMd = null;
    }

    // 2. Project settings
    let projectSettings: object | null = null;
    try {
      const settingsPath = path.join(projectPath, ".claude", "settings.json");
      projectSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      projectSettings = null;
    }

    // 3. Skills — list subdirs of .claude/skills/ that contain SKILL.md
    const skills: { name: string; markdownId: string }[] = [];
    try {
      const skillsDir = path.join(projectPath, ".claude", "skills");
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md").replace(/\\/g, "/");
          if (fs.existsSync(skillMdPath)) {
            skills.push({ name: entry.name, markdownId: entityId(`markdown:${skillMdPath}`) });
          }
        }
      }
    } catch {
      // no skills directory
    }

    // 4. Project hooks
    let projectHooks: object | null = null;
    try {
      const hooksPath = path.join(projectPath, ".claude", "hooks.json");
      projectHooks = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    } catch {
      projectHooks = null;
    }

    // 5. Project MCP servers (may be wrapped in { mcpServers: { ... } })
    let projectMcp: object | null = null;
    try {
      const mcpPath = path.join(projectPath, ".mcp.json");
      const raw = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
      projectMcp = raw?.mcpServers || raw;
    } catch {
      projectMcp = null;
    }

    // 6. Memory files
    const memoryFiles: { name: string; markdownId: string }[] = [];
    try {
      const encodedKey = projectPath.replace(/\//g, "-");
      const memoryDir = path.join(os.homedir(), ".claude", "projects", encodedKey, "memory").replace(/\\/g, "/");
      const entries = fs.readdirSync(memoryDir);
      for (const e of entries) {
        const fullPath = path.join(memoryDir, e).replace(/\\/g, "/");
        try {
          if (fs.statSync(fullPath).isFile()) {
            memoryFiles.push({ name: e, markdownId: entityId(`markdown:${fullPath}`) });
          }
        } catch {}
      }
    } catch {
      // no memory directory
    }

    return {
      id: project.id,
      name: (project as any).name ?? project.id,
      path: projectPath,
      rules: {
        claudeMd,
        claudeMdId,
        projectSettings,
        globalSettings,
        skills,
        hooks: { project: projectHooks, global: globalHooks },
        mcpServers: { project: projectMcp, global: globalMcp },
        memoryFiles,
      },
    };
  });

  res.json(result);
});

router.get("/api/projects/:id", (req: Request, res: Response) => {
  const project = storage.getEntity(req.params.id as string);
  if (!project || project.type !== "project") {
    return res.status(404).json({ message: "Project not found" });
  }

  const rels = storage.getRelationships(project.id);
  const linkedIds = rels.map((r) => (r.sourceId === project.id ? r.targetId : r.sourceId));
  const linkedEntities = linkedIds.map((id) => storage.getEntity(id)).filter(Boolean);

  res.json({ project, relationships: rels, linkedEntities });
});

/** POST /api/projects/:id/open-terminal — open a terminal in the project's directory */
router.post("/api/projects/:id/open-terminal", (req: Request, res: Response) => {
  const project = storage.getEntity(req.params.id as string);
  if (!project || project.type !== "project") {
    return res.status(404).json({ message: "Project not found" });
  }
  const dir = (project as any).path as string;
  // Guard: the dir is a real path at scan time, but it may have been moved or
  // deleted since. Fail clearly rather than opening a terminal in nowhere.
  if (!dir || !fs.existsSync(dir)) {
    return res.status(404).json({ message: `Project directory no longer exists: ${dir || "(unknown)"}` });
  }
  const result = openTerminalInDir(dir);
  if (result.status === "failed") {
    return res.status(500).json(result);
  }
  res.json(result);
});

export default router;
