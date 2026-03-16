import { storage } from "../storage";
import { scanMCPs, extractDbNodesFromMcps } from "./mcp-scanner";
import { scanSkills } from "./skill-scanner";
import { scanPlugins } from "./plugin-scanner";
import { scanProjects, scanEnvServices, scanGitRemotes } from "./project-scanner";
import { scanMarkdown } from "./markdown-scanner";
import { scanConfigs } from "./config-scanner";
import { scanAllSessions } from "./session-scanner";
import { scanAgentDefinitions, scanAgentExecutions } from "./agent-scanner";
import { scanDockerCompose } from "./importers/docker-compose";
import { scanGraphConfig } from "./graph-config-scanner";
import { scanApiConfig } from "./api-config-scanner";
import { entityId } from "./utils";
import { buildRelationships } from "./relationships";
import { getDB, save } from "../db";
import type { Entity, EntityType, CustomNode, CustomEdge } from "@shared/types";

let scanning = false;
let scanVersion = 0;
let lastScanDuration = 0;

// SSE clients waiting for scan events
const sseClients: Set<(data: string) => void> = new Set();

export function isScanning(): boolean {
  return scanning;
}

export function getScanVersion(): number {
  return scanVersion;
}

export function getLastScanDuration(): number {
  return lastScanDuration;
}

export function addSSEClient(send: (data: string) => void): () => void {
  sseClients.add(send);
  return () => sseClients.delete(send);
}

function notifyClients(event: string, data: unknown): void {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((send) => {
    try { send(msg); } catch { sseClients.delete(send); }
  });
}

export async function runFullScan(): Promise<void> {
  if (scanning) return;
  scanning = true;

  try {
    const start = Date.now();
    notifyClients("scan-start", { version: scanVersion + 1 });

    // Run all scanners
    const mcps = scanMCPs();
    const skills = scanSkills();
    const plugins = scanPlugins();
    const projects = scanProjects();
    const markdowns = scanMarkdown();
    const configs = scanConfigs();
    const { perProject } = scanAllSessions();

    // Agent scanners
    scanAgentDefinitions();
    scanAgentExecutions();

    // Build new entity map atomically (no delete-then-reinsert gap)
    const allEntities: Entity[] = [...mcps, ...skills, ...plugins, ...projects, ...markdowns, ...configs];
    const newEntities: Record<string, Entity> = {};
    for (const entity of allEntities) {
      newEntities[entity.id] = entity;
    }

    // Update project session counts
    for (const agg of perProject) {
      const projectId = entityId(`project:${agg.projectKey}`);
      const project = newEntities[projectId];
      if (project) {
        project.data = {
          ...project.data,
          sessionCount: agg.sessionCount,
          sessionSize: agg.totalSize,
        };
        if (agg.lastModified && (!project.lastModified || agg.lastModified > project.lastModified)) {
          project.lastModified = agg.lastModified;
        }
      }
    }

    // Atomic swap: replace entities and relationships in one operation
    const db = getDB();
    db.entities = newEntities;
    db.relationships = [];
    db.nextRelId = 1;
    save();

    // Build relationships (adds to the now-empty array)
    buildRelationships(projects, mcps, skills, markdowns, plugins);

    // Enhanced auto-discovery: Docker Compose, DB URLs from MCPs, .env services, git remotes
    const allCustomNodes: CustomNode[] = [];
    const allCustomEdges: CustomEdge[] = [];

    try {
      const docker = scanDockerCompose();
      allCustomNodes.push(...docker.nodes);
      allCustomEdges.push(...docker.edges);
    } catch (err) {
      console.error("[scanner] Docker compose scan error:", err);
    }

    try {
      const dbNodes = extractDbNodesFromMcps(mcps);
      allCustomNodes.push(...dbNodes.nodes);
      allCustomEdges.push(...dbNodes.edges);
    } catch (err) {
      console.error("[scanner] DB URL extraction error:", err);
    }

    try {
      const envSvcs = scanEnvServices();
      allCustomNodes.push(...envSvcs.nodes);
      allCustomEdges.push(...envSvcs.edges);
    } catch (err) {
      console.error("[scanner] Env services scan error:", err);
    }

    try {
      const gitEdges = scanGitRemotes(projects);
      allCustomEdges.push(...gitEdges);
    } catch (err) {
      console.error("[scanner] Git remotes scan error:", err);
    }

    // Graph config file (user-defined YAML)
    try {
      const graphConfig = scanGraphConfig();
      allCustomNodes.push(...graphConfig.nodes);
      allCustomEdges.push(...graphConfig.edges);

      // Merge overrides (config-file overrides replace previous)
      if (Object.keys(graphConfig.overrides).length > 0) {
        storage.replaceEntityOverrides(graphConfig.overrides);
      }
    } catch (err) {
      console.error("[scanner] Graph config scan error:", err);
    }

    // API config file (apis-config.yaml)
    try {
      const apiConfig = scanApiConfig();
      // Skip nodes that already exist from graph-config.yaml
      const existingIds = new Set(allCustomNodes.map((n) => n.id));
      const newApiNodes = apiConfig.nodes.filter((n) => !existingIds.has(n.id));
      allCustomNodes.push(...newApiNodes);
      allCustomEdges.push(...apiConfig.edges);
    } catch (err) {
      console.error("[scanner] API config scan error:", err);
    }

    // Store auto-discovered + config custom nodes/edges (replace per source)
    const autoNodes = allCustomNodes.filter((n) => n.source === "auto-discovered");
    const dockerNodes = allCustomNodes.filter((n) => n.source === "docker-compose");
    const configNodes = allCustomNodes.filter((n) => n.source === "config-file");
    const apiConfigNodes = allCustomNodes.filter((n) => n.source === "api-config");
    storage.replaceCustomNodes(autoNodes, "auto-discovered");
    storage.replaceCustomNodes(dockerNodes, "docker-compose");
    storage.replaceCustomNodes(configNodes, "config-file");
    storage.replaceCustomNodes(apiConfigNodes, "api-config");

    const autoEdges = allCustomEdges.filter((e) => e.source_origin === "auto-discovered");
    const dockerEdges = allCustomEdges.filter((e) => e.source_origin === "docker-compose");
    const configEdges = allCustomEdges.filter((e) => e.source_origin === "config-file");
    const apiConfigEdges = allCustomEdges.filter((e) => e.source_origin === "api-config");
    storage.replaceCustomEdges(autoEdges, "auto-discovered");
    storage.replaceCustomEdges(dockerEdges, "docker-compose");
    storage.replaceCustomEdges(configEdges, "config-file");
    storage.replaceCustomEdges(apiConfigEdges, "api-config");

    lastScanDuration = Date.now() - start;
    scanVersion++;

    const customNodeCount = storage.getCustomNodes().length;
    const customEdgeCount = storage.getCustomEdges().length;
    const status = storage.getScanStatus();
    console.log(`[scanner] Scan v${scanVersion}: ${allEntities.length} entities, ${customNodeCount} custom nodes, ${customEdgeCount} custom edges, ${lastScanDuration}ms`);

    notifyClients("scan-complete", {
      version: scanVersion,
      duration: lastScanDuration,
      entityCounts: status.entityCounts,
      totalEntities: status.totalEntities,
      totalRelationships: status.totalRelationships,
      customNodes: customNodeCount,
      customEdges: customEdgeCount,
    });
  } finally {
    scanning = false;
  }
}

// Scanners that follow the standard pattern: scan → atomic replace by type
const entityScanners: Record<string, { scan: () => Entity[]; type: EntityType }> = {
  mcp:      { scan: scanMCPs,     type: "mcp" },
  skills:   { scan: scanSkills,   type: "skill" },
  plugins:  { scan: scanPlugins,  type: "plugin" },
  config:   { scan: scanConfigs,  type: "config" },
  markdown: { scan: scanMarkdown, type: "markdown" },
};

/** Run only the relevant scanner(s) for a specific change category */
export async function runPartialScan(
  category: "mcp" | "skills" | "sessions" | "agents" | "plugins" | "config" | "markdown",
): Promise<void> {
  if (scanning) return;
  scanning = true;

  try {
    const start = Date.now();
    const standard = entityScanners[category];

    if (standard) {
      const entities = standard.scan();
      storage.replaceEntitiesByType(standard.type, entities);
      console.log(`[scanner] Partial ${category} scan: ${entities.length} entities, ${Date.now() - start}ms`);
    } else if (category === "sessions") {
      scanAllSessions();
      console.log(`[scanner] Partial sessions scan: ${Date.now() - start}ms`);
    } else if (category === "agents") {
      scanAgentDefinitions();
      scanAgentExecutions();
      console.log(`[scanner] Partial agents scan: ${Date.now() - start}ms`);
    }

    scanVersion++;
    notifyClients("scan-complete", {
      version: scanVersion,
      duration: Date.now() - start,
      partial: category,
    });
  } finally {
    scanning = false;
  }
}
