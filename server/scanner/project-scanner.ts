import type { Entity } from "@shared/types";
import { entityId, getFileStat, CLAUDE_DIR, HOME, now, dirExists, fileExists, safeReadText, discoverProjectDirs, decodeProjectKey } from "./utils";
import path from "path";
import fs from "fs";

/** Pretty-print a directory name as a project name */
function dirToName(dirName: string): string {
  return dirName
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract first paragraph from CLAUDE.md as description */
function extractDescription(projectDir: string): string | null {
  const content = safeReadText(path.join(projectDir, "CLAUDE.md"));
  if (!content) return null;
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---") || trimmed.startsWith("```")) continue;
    return trimmed.slice(0, 200);
  }
  return null;
}

/** Auto-detect tech stack from project files */
function detectTechStack(projectDir: string): string[] {
  const stack: string[] = [];
  if (fileExists(path.join(projectDir, "package.json"))) {
    stack.push("Node.js");
    if (fileExists(path.join(projectDir, "tsconfig.json"))) stack.push("TypeScript");
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps.react) stack.push("React");
      if (allDeps.express) stack.push("Express");
      if (allDeps.next) stack.push("Next.js");
      if (allDeps.vue) stack.push("Vue");
      if (allDeps.svelte) stack.push("Svelte");
    } catch {}
  }
  if (fileExists(path.join(projectDir, "requirements.txt")) || fileExists(path.join(projectDir, "pyproject.toml"))) stack.push("Python");
  if (fileExists(path.join(projectDir, "Cargo.toml"))) stack.push("Rust");
  if (fileExists(path.join(projectDir, "go.mod"))) stack.push("Go");
  if (fileExists(path.join(projectDir, "docker-compose.yml")) || fileExists(path.join(projectDir, "docker-compose.test.yml")) || fileExists(path.join(projectDir, "Dockerfile"))) stack.push("Docker");
  return stack;
}

export function scanProjects(): Entity[] {
  const results: Entity[] = [];
  const projectDirs = discoverProjectDirs();

  for (const projectDir of projectDirs) {
    const dirName = path.basename(projectDir);
    const stat = getFileStat(projectDir);
    const hasClaudeMd = fileExists(path.join(projectDir, "CLAUDE.md"));
    const hasPackageJson = fileExists(path.join(projectDir, "package.json"));
    const hasGit = dirExists(path.join(projectDir, ".git"));
    const hasMcpJson = fileExists(path.join(projectDir, ".mcp.json"));

    const sessionInfo = getSessionInfo(projectDir);

    const tags: string[] = [];
    if (hasClaudeMd) tags.push("claude-md");
    if (hasGit) tags.push("git");
    if (hasPackageJson) tags.push("node");
    if (hasMcpJson) tags.push("mcp");
    if (fileExists(path.join(projectDir, "docker-compose.yml")) || fileExists(path.join(projectDir, "docker-compose.test.yml"))) tags.push("docker");
    if (fileExists(path.join(projectDir, "requirements.txt")) || fileExists(path.join(projectDir, "pyproject.toml"))) tags.push("python");

    const description = extractDescription(projectDir) || `Project with ${hasClaudeMd ? "CLAUDE.md" : hasMcpJson ? ".mcp.json" : "package.json"}`;
    const techStack = detectTechStack(projectDir);

    const id = entityId(`project:${dirName}`);
    results.push({
      id,
      type: "project",
      name: dirToName(dirName),
      path: projectDir,
      description,
      lastModified: stat?.mtime ?? null,
      tags,
      health: hasClaudeMd || hasPackageJson ? "ok" : "unknown",
      data: {
        projectKey: dirName,
        dirName,
        sessionCount: sessionInfo.sessionCount,
        sessionSize: sessionInfo.sessionSize,
        hasClaudeMd,
        hasPackageJson,
        hasGit,
        hasMcpJson,
        hasMemory: sessionInfo.hasMemory,
        techStack: techStack.length > 0 ? techStack : undefined,
      },
      scannedAt: now(),
    });
  }

  return results;
}

// Find Claude Code session data for a project directory
function getSessionInfo(projectDir: string): { sessionCount: number; sessionSize: number; hasMemory: boolean } {
  const projectsDir = path.join(CLAUDE_DIR, "projects").replace(/\\/g, "/");
  if (!dirExists(projectsDir)) return { sessionCount: 0, sessionSize: 0, hasMemory: false };

  const homeNorm = HOME.replace(/\\/g, "/");

  try {
    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const decoded = decodeProjectKey(dir.name);
      if (decoded === projectDir || (decoded === homeNorm && projectDir.startsWith(homeNorm))) {
        const claudeDir = path.join(projectsDir, dir.name).replace(/\\/g, "/");
        let sessionCount = 0;
        let sessionSize = 0;
        try {
          const files = fs.readdirSync(claudeDir, { withFileTypes: true });
          for (const f of files) {
            if (f.isFile() && f.name.endsWith(".jsonl")) {
              sessionCount++;
              const fstat = getFileStat(path.join(claudeDir, f.name));
              if (fstat) sessionSize += fstat.size;
            }
          }
        } catch {}
        const hasMemory = dirExists(path.join(claudeDir, "memory"));
        return { sessionCount, sessionSize, hasMemory };
      }
    }
  } catch {}

  return { sessionCount: 0, sessionSize: 0, hasMemory: false };
}
