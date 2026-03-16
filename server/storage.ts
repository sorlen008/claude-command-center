import { getDB, save } from "./db";
import type { Entity, EntityType, Relationship, MarkdownBackup, ScanStatus, AppSettings, CustomNode, CustomEdge, EntityOverride } from "@shared/types";
import { getCachedStats } from "./scanner/session-scanner";
import { getCachedAgentStats } from "./scanner/agent-scanner";

export class Storage {
  // Entities
  upsertEntity(entity: Entity): void {
    const db = getDB();
    db.entities[entity.id] = entity;
    save();
  }

  getEntity(id: string): Entity | null {
    return getDB().entities[id] || null;
  }

  getEntities(type?: EntityType, query?: string): Entity[] {
    const db = getDB();
    let results = Object.values(db.entities);
    if (type) results = results.filter((e) => e.type === type);
    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.description || "").toLowerCase().includes(q) ||
          e.path.toLowerCase().includes(q)
      );
    }
    return results;
  }

  /** Atomic replace: delete all entities of a type and insert new ones in one operation */
  replaceEntitiesByType(type: EntityType, entities: Entity[]): void {
    const db = getDB();
    for (const id of Object.keys(db.entities)) {
      if (db.entities[id].type === type) {
        delete db.entities[id];
      }
    }
    for (const entity of entities) {
      db.entities[entity.id] = entity;
    }
    save();
  }

  // Relationships
  addRelationship(rel: Omit<Relationship, "id">): void {
    const db = getDB();
    const id = db.nextRelId++;
    db.relationships.push({ id, ...rel });
    save();
  }

  getRelationships(entityId: string): Relationship[] {
    return getDB().relationships.filter(
      (r) => r.sourceId === entityId || r.targetId === entityId
    );
  }

  clearRelationships(): void {
    const db = getDB();
    db.relationships = [];
    db.nextRelId = 1;
    save();
  }

  getAllRelationships(): Relationship[] {
    return getDB().relationships;
  }

  // Markdown Backups
  createBackup(filePath: string, content: string, reason: string): void {
    const db = getDB();
    const id = db.nextBackupId++;
    db.markdownBackups.push({
      id,
      filePath,
      content,
      createdAt: new Date().toISOString(),
      reason,
    });

    // Keep only last 20 per file
    const forFile = db.markdownBackups.filter((b) => b.filePath === filePath);
    if (forFile.length > 20) {
      const toRemove = forFile.slice(0, forFile.length - 20).map((b) => b.id);
      db.markdownBackups = db.markdownBackups.filter((b) => !toRemove.includes(b.id));
    }
    save();
  }

  getBackups(filePath: string): MarkdownBackup[] {
    return getDB()
      .markdownBackups.filter((b) => b.filePath === filePath)
      .sort((a, b) => b.id - a.id);
  }

  getBackup(id: number): MarkdownBackup | null {
    return getDB().markdownBackups.find((b) => b.id === id) || null;
  }

  // Discovery Cache
  getCachedDiscovery(query: string): string | null {
    const entry = getDB().discoveryCache[query];
    if (!entry) return null;
    if (Date.now() - new Date(entry.cachedAt).getTime() > 3600000) return null;
    return entry.results;
  }

  setCachedDiscovery(query: string, results: string): void {
    const db = getDB();
    db.discoveryCache[query] = { results, cachedAt: new Date().toISOString() };
    // Cap cache at 100 entries (LRU: remove oldest)
    const keys = Object.keys(db.discoveryCache);
    if (keys.length > 100) {
      const sorted = keys.sort((a, b) => {
        const aTime = new Date(db.discoveryCache[a].cachedAt).getTime();
        const bTime = new Date(db.discoveryCache[b].cachedAt).getTime();
        return aTime - bTime;
      });
      for (const key of sorted.slice(0, keys.length - 100)) {
        delete db.discoveryCache[key];
      }
    }
    save();
  }

  // App Settings
  getAppSettings(): AppSettings {
    return getDB().appSettings;
  }

  updateAppSettings(patch: Partial<AppSettings>): AppSettings {
    const db = getDB();
    if (patch.appName !== undefined) db.appSettings.appName = patch.appName;
    if (patch.onboarded !== undefined) db.appSettings.onboarded = patch.onboarded;
    if (patch.scanPaths) {
      db.appSettings.scanPaths = { ...db.appSettings.scanPaths, ...patch.scanPaths };
    }
    save();
    return db.appSettings;
  }

  // Custom Nodes
  getCustomNodes(): CustomNode[] {
    return getDB().customNodes;
  }

  upsertCustomNode(node: CustomNode): void {
    const db = getDB();
    const idx = db.customNodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) {
      db.customNodes[idx] = node;
    } else {
      db.customNodes.push(node);
    }
    save();
  }

  deleteCustomNode(id: string): void {
    const db = getDB();
    db.customNodes = db.customNodes.filter((n) => n.id !== id);
    // Also remove edges referencing this node
    db.customEdges = db.customEdges.filter((e) => e.source !== id && e.target !== id);
    save();
  }

  replaceCustomNodes(nodes: CustomNode[], source: string): void {
    const db = getDB();
    // Remove nodes from this source, then add new ones
    db.customNodes = db.customNodes.filter((n) => n.source !== source);
    db.customNodes.push(...nodes);
    save();
  }

  // Custom Edges
  getCustomEdges(): CustomEdge[] {
    return getDB().customEdges;
  }

  upsertCustomEdge(edge: CustomEdge): void {
    const db = getDB();
    const idx = db.customEdges.findIndex((e) => e.id === edge.id);
    if (idx >= 0) {
      db.customEdges[idx] = edge;
    } else {
      db.customEdges.push(edge);
    }
    save();
  }

  deleteCustomEdge(id: string): void {
    const db = getDB();
    db.customEdges = db.customEdges.filter((e) => e.id !== id);
    save();
  }

  replaceCustomEdges(edges: CustomEdge[], source: string): void {
    const db = getDB();
    db.customEdges = db.customEdges.filter((e) => e.source_origin !== source);
    db.customEdges.push(...edges);
    save();
  }

  // Entity Overrides
  getEntityOverrides(): Record<string, EntityOverride> {
    return getDB().entityOverrides;
  }

  setEntityOverride(entityId: string, override: EntityOverride): void {
    const db = getDB();
    db.entityOverrides[entityId] = override;
    save();
  }

  deleteEntityOverride(entityId: string): void {
    const db = getDB();
    delete db.entityOverrides[entityId];
    save();
  }

  replaceEntityOverrides(overrides: Record<string, EntityOverride>): void {
    const db = getDB();
    db.entityOverrides = overrides;
    save();
  }

  // Stats
  getScanStatus(): ScanStatus {
    const db = getDB();
    const entities = Object.values(db.entities);
    const counts: Record<string, number> = {};
    for (const e of entities) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }

    const lastScan = entities.reduce(
      (latest, e) => (e.scannedAt > (latest || "") ? e.scannedAt : latest),
      null as string | null
    );

    return {
      scanning: false,
      lastScanAt: lastScan,
      entityCounts: counts as Record<EntityType, number>,
      totalEntities: entities.length,
      totalRelationships: db.relationships.length,
      sessionCount: getCachedStats().totalCount,
      agentCount: getCachedAgentStats().totalDefinitions,
    };
  }
}

export const storage = new Storage();
