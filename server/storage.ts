import { getDB, save } from "./db";
import type { Entity, EntityType, Relationship, MarkdownBackup, ScanStatus } from "@shared/types";
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

  deleteEntitiesByType(type: EntityType): void {
    const db = getDB();
    for (const id of Object.keys(db.entities)) {
      if (db.entities[id].type === type) {
        delete db.entities[id];
      }
    }
    save();
  }

  deleteEntity(id: string): void {
    const db = getDB();
    delete db.entities[id];
    db.relationships = db.relationships.filter((r) => r.sourceId !== id && r.targetId !== id);
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
      agentCount: getCachedAgentStats().totalExecutions,
    };
  }
}

export const storage = new Storage();
