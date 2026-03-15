import { storage } from "../storage";
import { scanMCPs } from "./mcp-scanner";
import { scanSkills } from "./skill-scanner";
import { scanPlugins } from "./plugin-scanner";
import { scanProjects } from "./project-scanner";
import { scanMarkdown } from "./markdown-scanner";
import { scanConfigs } from "./config-scanner";
import { scanAllSessions } from "./session-scanner";
import { scanAgentDefinitions, scanAgentExecutions } from "./agent-scanner";
import { entityId } from "./utils";
import { buildRelationships } from "./relationships";
import type { Entity, EntityType } from "@shared/types";

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
    try { send(msg); } catch {}
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

    // Clear old data
    for (const type of ["mcp", "skill", "plugin", "project", "markdown", "config"] as EntityType[]) {
      storage.deleteEntitiesByType(type);
    }
    storage.clearRelationships();

    // Upsert all entities
    const allEntities: Entity[] = [...mcps, ...skills, ...plugins, ...projects, ...markdowns, ...configs];
    for (const entity of allEntities) {
      storage.upsertEntity(entity);
    }

    // Update project session counts from session scanner
    for (const agg of perProject) {
      const projectId = entityId(`project:${agg.projectKey}`);
      const project = storage.getEntity(projectId);
      if (project) {
        project.data = {
          ...project.data,
          sessionCount: agg.sessionCount,
          sessionSize: agg.totalSize,
        };
        if (agg.lastModified && (!project.lastModified || agg.lastModified > project.lastModified)) {
          project.lastModified = agg.lastModified;
        }
        storage.upsertEntity(project);
      }
    }

    // Build relationships
    buildRelationships(projects, mcps, skills, markdowns, plugins);

    lastScanDuration = Date.now() - start;
    scanVersion++;

    const status = storage.getScanStatus();
    console.log(`[scanner] Scan v${scanVersion}: ${allEntities.length} entities, ${lastScanDuration}ms`);

    notifyClients("scan-complete", {
      version: scanVersion,
      duration: lastScanDuration,
      entityCounts: status.entityCounts,
      totalEntities: status.totalEntities,
      totalRelationships: status.totalRelationships,
    });
  } finally {
    scanning = false;
  }
}

// buildRelationships is now in ./relationships.ts
