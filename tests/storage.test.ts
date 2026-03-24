import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { Entity, EntityType, CustomNode, CustomEdge } from "@shared/types";

// Set COMMAND_CENTER_DATA before importing storage/db so the module uses our temp dir
const tmpDir = path.join(os.tmpdir(), "cc-storage-test-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
process.env.COMMAND_CENTER_DATA = tmpDir;

// Dynamic import so env var is read at module init time
const { Storage } = await import("../server/storage");
const { getDB } = await import("../server/db");

function makeEntity(id: string, type: EntityType = "project", extra?: Partial<Entity>): Entity {
  return {
    id,
    type,
    name: extra?.name ?? `Entity ${id}`,
    path: extra?.path ?? `/test/${id}`,
    description: extra?.description ?? null,
    lastModified: extra?.lastModified ?? null,
    tags: extra?.tags ?? [],
    health: extra?.health ?? "ok",
    data: extra?.data ?? {},
    scannedAt: extra?.scannedAt ?? new Date().toISOString(),
  };
}

describe("Storage", () => {
  let storage: InstanceType<typeof Storage>;

  beforeEach(() => {
    // Reset the DB file between tests for a clean state
    const dbPath = path.join(tmpDir, "command-center.json");
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    const tmpPath = dbPath + ".tmp";
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    // Reset the in-memory DB via the module-level getDB() reference
    const db = getDB();
    // Clear all data
    for (const key of Object.keys(db.entities)) delete db.entities[key];
    db.relationships = [];
    db.nextRelId = 1;
    db.markdownBackups = [];
    db.nextBackupId = 1;
    db.discoveryCache = {};
    db.customNodes = [];
    db.customEdges = [];
    db.entityOverrides = {};

    storage = new Storage();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --- upsertEntity + getEntity ---

  describe("upsertEntity + getEntity", () => {
    it("inserts and retrieves an entity", () => {
      const entity = makeEntity("e1", "project", { name: "My Project" });
      storage.upsertEntity(entity);

      const result = storage.getEntity("e1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("e1");
      expect(result!.name).toBe("My Project");
      expect(result!.type).toBe("project");
    });

    it("returns null for non-existent entity", () => {
      expect(storage.getEntity("nonexistent")).toBeNull();
    });

    it("updates an existing entity on re-upsert", () => {
      const entity = makeEntity("e1", "project", { name: "Original" });
      storage.upsertEntity(entity);

      const updated = makeEntity("e1", "project", { name: "Updated" });
      storage.upsertEntity(updated);

      const result = storage.getEntity("e1");
      expect(result!.name).toBe("Updated");
    });
  });

  // --- getEntities ---

  describe("getEntities", () => {
    it("returns all entities when no filter", () => {
      storage.upsertEntity(makeEntity("e1", "project"));
      storage.upsertEntity(makeEntity("e2", "mcp"));
      storage.upsertEntity(makeEntity("e3", "skill"));

      const all = storage.getEntities();
      expect(all).toHaveLength(3);
    });

    it("filters by type", () => {
      storage.upsertEntity(makeEntity("e1", "project"));
      storage.upsertEntity(makeEntity("e2", "mcp"));
      storage.upsertEntity(makeEntity("e3", "project"));

      const projects = storage.getEntities("project");
      expect(projects).toHaveLength(2);
      expect(projects.every((e) => e.type === "project")).toBe(true);
    });

    it("filters by query (name match)", () => {
      storage.upsertEntity(makeEntity("e1", "project", { name: "MyApp" }));
      storage.upsertEntity(makeEntity("e2", "project", { name: "Automation" }));

      const results = storage.getEntities(undefined, "myapp");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("MyApp");
    });

    it("filters by query (description match)", () => {
      storage.upsertEntity(makeEntity("e1", "project", { description: "Finance dashboard" }));
      storage.upsertEntity(makeEntity("e2", "project", { description: "Chat bot" }));

      const results = storage.getEntities(undefined, "finance");
      expect(results).toHaveLength(1);
    });

    it("filters by query (path match)", () => {
      storage.upsertEntity(makeEntity("e1", "project", { path: "/home/user/my-app" }));
      storage.upsertEntity(makeEntity("e2", "project", { path: "/home/user/automation" }));

      const results = storage.getEntities(undefined, "my-app");
      expect(results).toHaveLength(1);
    });

    it("combines type and query filters", () => {
      storage.upsertEntity(makeEntity("e1", "project", { name: "MyApp" }));
      storage.upsertEntity(makeEntity("e2", "mcp", { name: "MyApp MCP" }));

      const results = storage.getEntities("mcp", "myapp");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("mcp");
    });
  });

  // --- replaceEntitiesByType ---

  describe("replaceEntitiesByType", () => {
    it("replaces all entities of a given type atomically", () => {
      storage.upsertEntity(makeEntity("old1", "mcp", { name: "Old MCP 1" }));
      storage.upsertEntity(makeEntity("old2", "mcp", { name: "Old MCP 2" }));
      storage.upsertEntity(makeEntity("keep1", "project", { name: "Keep Me" }));

      const newEntities = [
        makeEntity("new1", "mcp", { name: "New MCP 1" }),
        makeEntity("new2", "mcp", { name: "New MCP 2" }),
        makeEntity("new3", "mcp", { name: "New MCP 3" }),
      ];
      storage.replaceEntitiesByType("mcp", newEntities);

      const mcps = storage.getEntities("mcp");
      expect(mcps).toHaveLength(3);
      expect(mcps.map((e) => e.name).sort()).toEqual(["New MCP 1", "New MCP 2", "New MCP 3"]);

      // Project entity should not be affected
      const projects = storage.getEntities("project");
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("Keep Me");
    });

    it("removes old entities even when replacement list is empty", () => {
      storage.upsertEntity(makeEntity("old1", "skill"));
      storage.upsertEntity(makeEntity("old2", "skill"));

      storage.replaceEntitiesByType("skill", []);

      expect(storage.getEntities("skill")).toHaveLength(0);
    });
  });

  // --- addRelationship + getRelationships ---

  describe("addRelationship + getRelationships", () => {
    it("adds and retrieves a relationship by source", () => {
      storage.addRelationship({
        sourceId: "a",
        sourceType: "project",
        targetId: "b",
        targetType: "mcp",
        relation: "uses",
      });

      const rels = storage.getRelationships("a");
      expect(rels).toHaveLength(1);
      expect(rels[0].sourceId).toBe("a");
      expect(rels[0].targetId).toBe("b");
      expect(rels[0].relation).toBe("uses");
      expect(typeof rels[0].id).toBe("number");
    });

    it("retrieves relationships by target", () => {
      storage.addRelationship({
        sourceId: "a",
        sourceType: "project",
        targetId: "b",
        targetType: "mcp",
        relation: "uses",
      });

      const rels = storage.getRelationships("b");
      expect(rels).toHaveLength(1);
      expect(rels[0].targetId).toBe("b");
    });

    it("assigns incrementing IDs", () => {
      storage.addRelationship({
        sourceId: "a",
        sourceType: "project",
        targetId: "b",
        targetType: "mcp",
        relation: "uses",
      });
      storage.addRelationship({
        sourceId: "c",
        sourceType: "skill",
        targetId: "d",
        targetType: "plugin",
        relation: "extends",
      });

      const all = storage.getAllRelationships();
      expect(all).toHaveLength(2);
      expect(all[0].id).toBeLessThan(all[1].id);
    });

    it("returns empty array for unknown entity", () => {
      expect(storage.getRelationships("nonexistent")).toHaveLength(0);
    });
  });

  // --- replaceCustomNodes ---

  describe("replaceCustomNodes", () => {
    it("replaces nodes from a given source, keeping others", () => {
      const manual: CustomNode = {
        id: "manual-1",
        subType: "service",
        label: "Manual Service",
        source: "manual",
      };
      const apiNode1: CustomNode = {
        id: "api-1",
        subType: "api",
        label: "Old API",
        source: "api-config",
      };

      storage.upsertCustomNode(manual);
      storage.upsertCustomNode(apiNode1);

      const newApiNodes: CustomNode[] = [
        { id: "api-2", subType: "api", label: "New API A", source: "api-config" },
        { id: "api-3", subType: "api", label: "New API B", source: "api-config" },
      ];

      storage.replaceCustomNodes(newApiNodes, "api-config");

      const allNodes = storage.getCustomNodes();
      expect(allNodes).toHaveLength(3); // 1 manual + 2 new api
      expect(allNodes.find((n) => n.id === "manual-1")).toBeDefined();
      expect(allNodes.find((n) => n.id === "api-1")).toBeUndefined(); // old api removed
      expect(allNodes.find((n) => n.id === "api-2")).toBeDefined();
      expect(allNodes.find((n) => n.id === "api-3")).toBeDefined();
    });

    it("removes all nodes of a source when replacement is empty", () => {
      storage.upsertCustomNode({
        id: "dc-1",
        subType: "service",
        label: "Docker Svc",
        source: "docker-compose",
      });

      storage.replaceCustomNodes([], "docker-compose");

      const nodes = storage.getCustomNodes();
      expect(nodes.find((n) => n.source === "docker-compose")).toBeUndefined();
    });
  });

  // --- replaceCustomEdges ---

  describe("replaceCustomEdges", () => {
    it("replaces edges from a given source_origin, keeping others", () => {
      const manualEdge: CustomEdge = {
        id: "edge-manual-1",
        source: "a",
        target: "b",
        label: "connects",
        source_origin: "manual",
      };
      const apiEdge: CustomEdge = {
        id: "edge-api-1",
        source: "c",
        target: "d",
        label: "uses_api",
        source_origin: "api-config",
      };

      storage.upsertCustomEdge(manualEdge);
      storage.upsertCustomEdge(apiEdge);

      const newApiEdges: CustomEdge[] = [
        { id: "edge-api-2", source: "e", target: "f", label: "uses_api", source_origin: "api-config" },
      ];

      storage.replaceCustomEdges(newApiEdges, "api-config");

      const allEdges = storage.getCustomEdges();
      expect(allEdges).toHaveLength(2); // 1 manual + 1 new api
      expect(allEdges.find((e) => e.id === "edge-manual-1")).toBeDefined();
      expect(allEdges.find((e) => e.id === "edge-api-1")).toBeUndefined(); // old api edge removed
      expect(allEdges.find((e) => e.id === "edge-api-2")).toBeDefined();
    });
  });

  // --- getEntityOverrides + setEntityOverride ---

  describe("getEntityOverrides + setEntityOverride", () => {
    it("sets and retrieves an override", () => {
      storage.setEntityOverride("e1", { description: "Custom description", color: "#ff0000" });

      const overrides = storage.getEntityOverrides();
      expect(overrides["e1"]).toBeDefined();
      expect(overrides["e1"].description).toBe("Custom description");
      expect(overrides["e1"].color).toBe("#ff0000");
    });

    it("returns empty object when no overrides exist", () => {
      const overrides = storage.getEntityOverrides();
      expect(Object.keys(overrides)).toHaveLength(0);
    });

    it("overwrites previous override for same entity", () => {
      storage.setEntityOverride("e1", { label: "First" });
      storage.setEntityOverride("e1", { label: "Second" });

      const overrides = storage.getEntityOverrides();
      expect(overrides["e1"].label).toBe("Second");
    });

    it("deleteEntityOverride removes the override", () => {
      storage.setEntityOverride("e1", { label: "Test" });
      storage.deleteEntityOverride("e1");

      const overrides = storage.getEntityOverrides();
      expect(overrides["e1"]).toBeUndefined();
    });
  });

  // --- getScanStatus ---

  describe("getScanStatus", () => {
    it("returns correct entity counts by type", () => {
      storage.upsertEntity(makeEntity("p1", "project"));
      storage.upsertEntity(makeEntity("p2", "project"));
      storage.upsertEntity(makeEntity("m1", "mcp"));
      storage.upsertEntity(makeEntity("s1", "skill"));

      const status = storage.getScanStatus();
      expect(status.totalEntities).toBe(4);
      expect(status.entityCounts["project"]).toBe(2);
      expect(status.entityCounts["mcp"]).toBe(1);
      expect(status.entityCounts["skill"]).toBe(1);
    });

    it("returns correct relationship count", () => {
      storage.addRelationship({
        sourceId: "a",
        sourceType: "project",
        targetId: "b",
        targetType: "mcp",
        relation: "uses",
      });
      storage.addRelationship({
        sourceId: "c",
        sourceType: "project",
        targetId: "d",
        targetType: "skill",
        relation: "has",
      });

      const status = storage.getScanStatus();
      expect(status.totalRelationships).toBe(2);
    });

    it("returns zero counts when empty", () => {
      const status = storage.getScanStatus();
      expect(status.totalEntities).toBe(0);
      expect(status.totalRelationships).toBe(0);
      expect(status.scanning).toBe(false);
    });

    it("returns the latest scannedAt as lastScanAt", () => {
      storage.upsertEntity(makeEntity("e1", "project", { scannedAt: "2025-01-01T00:00:00Z" }));
      storage.upsertEntity(makeEntity("e2", "mcp", { scannedAt: "2025-06-15T12:00:00Z" }));
      storage.upsertEntity(makeEntity("e3", "skill", { scannedAt: "2025-03-10T06:00:00Z" }));

      const status = storage.getScanStatus();
      expect(status.lastScanAt).toBe("2025-06-15T12:00:00Z");
    });
  });
});
