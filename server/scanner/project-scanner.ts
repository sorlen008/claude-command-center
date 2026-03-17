import type { Entity, CustomNode, CustomEdge } from "@shared/types";
import { entityId, getFileStat, CLAUDE_DIR, HOME, now, dirExists, fileExists, safeReadText, discoverProjectDirs, decodeProjectKey, getExtraPaths, normPath } from "./utils";
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

  // Extra project dirs from settings
  for (const extra of getExtraPaths().extraProjectDirs) {
    const normalized = extra.replace(/\\/g, "/");
    if (dirExists(normalized) && !projectDirs.includes(normalized)) projectDirs.push(normalized);
  }

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
      health: hasClaudeMd || hasPackageJson || hasGit ? "ok" : "unknown",
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
  const projectsDir = normPath(CLAUDE_DIR, "projects");
  if (!dirExists(projectsDir)) return { sessionCount: 0, sessionSize: 0, hasMemory: false };

  const homeNorm = HOME.replace(/\\/g, "/");

  try {
    const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const decoded = decodeProjectKey(dir.name);
      if (decoded === projectDir || (decoded === homeNorm && projectDir.startsWith(homeNorm))) {
        const claudeDir = normPath(projectsDir, dir.name);
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

/** Service URL patterns found in .env files */
const ENV_SERVICE_PATTERNS: { keyPattern: RegExp; urlPattern: RegExp; type: "api" | "service" | "database"; label: string }[] = [
  { keyPattern: /_URL$/i, urlPattern: /^https?:\/\//, type: "api", label: "External API" },
  { keyPattern: /_HOST$/i, urlPattern: /.+/, type: "service", label: "Service" },
  { keyPattern: /_ENDPOINT$/i, urlPattern: /^https?:\/\//, type: "api", label: "API Endpoint" },
  { keyPattern: /_BASE_URL$/i, urlPattern: /^https?:\/\//, type: "api", label: "API" },
  { keyPattern: /_API_URL$/i, urlPattern: /^https?:\/\//, type: "api", label: "API" },
];

/** Scan .env files in project directories for external service references */
export function scanEnvServices(): { nodes: CustomNode[]; edges: CustomEdge[] } {
  const nodes: CustomNode[] = [];
  const edges: CustomEdge[] = [];
  const seen = new Set<string>();
  const projectDirs = discoverProjectDirs();

  for (const dir of projectDirs) {
    const envPath = normPath(dir, ".env");
    if (!fileExists(envPath)) continue;

    try {
      const content = fs.readFileSync(envPath, "utf-8");
      const dirName = path.basename(dir);
      const projectId = entityId(`project:${dirName}`);

      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");

        // Skip secrets/tokens/passwords
        if (/secret|token|password|key|auth/i.test(key)) continue;
        if (!value || value === "***") continue;

        for (const { keyPattern, urlPattern, type, label } of ENV_SERVICE_PATTERNS) {
          if (keyPattern.test(key) && urlPattern.test(value)) {
            const nodeId = `env-svc-${key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
            if (seen.has(nodeId)) break;
            seen.add(nodeId);

            // Extract host from URL for label
            let serviceName = key.replace(/_URL$|_HOST$|_ENDPOINT$|_BASE_URL$|_API_URL$/i, "").replace(/_/g, " ");
            try {
              const url = new URL(value);
              serviceName = `${serviceName} (${url.hostname})`;
            } catch {
              serviceName = `${serviceName}`;
            }

            // Redact credentials from URL values (e.g., postgres://user:pass@host → postgres://***@host)
            let safeValue = value;
            try {
              const parsed = new URL(value);
              if (parsed.username || parsed.password) {
                parsed.username = "***";
                parsed.password = "";
                safeValue = parsed.toString();
              }
            } catch {
              // Not a URL, truncate as-is
            }

            nodes.push({
              id: nodeId,
              subType: type,
              label: serviceName,
              description: `${label}: ${safeValue.slice(0, 80)}${safeValue.length > 80 ? "..." : ""}`,
              color: type === "api" ? "#f97316" : "#64748b",
              source: "auto-discovered",
            });

            edges.push({
              id: `env-edge-${projectId}-${nodeId}`,
              source: projectId,
              target: nodeId,
              label: "uses",
              source_origin: "auto-discovered",
            });
            break;
          }
        }
      }
    } catch {
      // Skip unreadable .env files
    }
  }

  return { nodes, edges };
}

/** Scan git remotes to detect shared-remote relationships between projects */
export function scanGitRemotes(projects: Entity[]): CustomEdge[] {
  const edges: CustomEdge[] = [];
  const remoteToProjects = new Map<string, string[]>();

  for (const project of projects) {
    const gitConfigPath = normPath(project.path, ".git", "config");
    if (!fileExists(gitConfigPath)) continue;

    try {
      const content = fs.readFileSync(gitConfigPath, "utf-8");
      const urlMatch = content.match(/url\s*=\s*(.+)/g);
      if (!urlMatch) continue;

      for (const line of urlMatch) {
        const url = line.replace(/url\s*=\s*/, "").trim();
        // Normalize git remote URL
        const normalized = url
          .replace(/\.git$/, "")
          .replace(/^git@([^:]+):/, "https://$1/")
          .toLowerCase();

        const existing = remoteToProjects.get(normalized) || [];
        existing.push(project.id);
        remoteToProjects.set(normalized, existing);
      }
    } catch {}
  }

  // Create edges between projects sharing the same remote
  remoteToProjects.forEach((projectIds) => {
    if (projectIds.length < 2) return;
    for (let i = 0; i < projectIds.length - 1; i++) {
      for (let j = i + 1; j < projectIds.length; j++) {
        edges.push({
          id: `git-shared-${projectIds[i]}-${projectIds[j]}`,
          source: projectIds[i],
          target: projectIds[j],
          label: "shares_remote",
          dashed: true,
          source_origin: "auto-discovered",
        });
      }
    }
  });

  return edges;
}
