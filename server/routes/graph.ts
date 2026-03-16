import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import dagre from "@dagrejs/dagre";
import type { GraphData, GraphNode, EntityType, GraphNodeType, CustomNode, CustomEdge } from "@shared/types";
import { getCachedSessions } from "../scanner/session-scanner";
import { decodeProjectKey } from "../scanner/utils";

const router = Router();

// Edge style per relationship type
const EDGE_STYLES: Record<string, { color: string; strokeWidth: number; dashed?: boolean; dotted?: boolean }> = {
  uses_mcp:        { color: "#22c55e", strokeWidth: 2.5 },
  defines_mcp:     { color: "#3b82f6", strokeWidth: 2 },
  has_skill:       { color: "#f97316", strokeWidth: 2 },
  has_memory:      { color: "#a78bfa", strokeWidth: 1.5, dashed: true },
  has_claude_md:   { color: "#60a5fa", strokeWidth: 2 },
  has_docs:        { color: "#94a3b8", strokeWidth: 1, dashed: true },
  provides_mcp:    { color: "#c084fc", strokeWidth: 2.5 },
  serves_data_for: { color: "#f59e0b", strokeWidth: 2.5, dotted: true },
  syncs:           { color: "#34d399", strokeWidth: 2, dashed: true },
  has_session:     { color: "#06b6d4", strokeWidth: 1.5, dashed: true },
  connects_to:     { color: "#f59e0b", strokeWidth: 2, dotted: true },
  depends_on:      { color: "#ef4444", strokeWidth: 2 },
  uses:            { color: "#f97316", strokeWidth: 1.5, dashed: true },
  shares_remote:   { color: "#34d399", strokeWidth: 1.5, dashed: true },
  uses_api:        { color: "#f59e0b", strokeWidth: 2 },
};

// Custom node subtype colors
const CUSTOM_SUBTYPE_COLORS: Record<string, string> = {
  service: "#06b6d4",
  database: "#f59e0b",
  api: "#f97316",
  cicd: "#8b5cf6",
  deploy: "#10b981",
  queue: "#a855f7",
  cache: "#ef4444",
  other: "#64748b",
};

// Node dimensions by entity type
const PROJECT_WIDTH = 280;
const PROJECT_HEIGHT = 80;
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 60;
const SESSION_WIDTH = 140;
const SESSION_HEIGHT = 36;
const CUSTOM_WIDTH = 200;
const CUSTOM_HEIGHT = 60;

router.get("/api/graph", (req: Request, res: Response) => {
  const typesParam = req.query.types as string | undefined;
  const layoutDir = (req.query.layout as string) || "TB";
  const groupParam = req.query.group === "true";
  const requestedTypes = typesParam ? typesParam.split(",") : undefined;
  const includeSessions = requestedTypes?.includes("session") ?? false;
  const includeCustom = requestedTypes?.includes("custom") ?? !requestedTypes;
  const allowedTypes = requestedTypes
    ? (requestedTypes.filter((t) => t !== "session" && t !== "custom") as EntityType[])
    : undefined;

  // Get all entities (optionally filtered by types)
  let allEntities = storage.getEntities();
  if (allowedTypes && allowedTypes.length > 0) {
    allEntities = allEntities.filter((e) => allowedTypes.includes(e.type));
  }

  const allRels = storage.getAllRelationships();

  // Filter relationships to only include entities in our set
  const entityIds = new Set(allEntities.map((e) => e.id));
  const filteredRels = allRels.filter(
    (r) => entityIds.has(r.sourceId) && entityIds.has(r.targetId)
  );

  // Build dagre graph for layout
  const rankdir = layoutDir === "LR" ? "LR" : "TB";
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 80, ranksep: 160, marginx: 60, marginy: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const entity of allEntities) {
    const isProject = entity.type === "project";
    g.setNode(entity.id, {
      width: isProject ? PROJECT_WIDTH : DEFAULT_WIDTH,
      height: isProject ? PROJECT_HEIGHT : DEFAULT_HEIGHT,
    });
  }

  for (const rel of filteredRels) {
    g.setEdge(rel.sourceId, rel.targetId);
  }

  // Inject custom nodes (docker-compose, DB URLs, env services, graph-config)
  const customNodesList: CustomNode[] = [];
  const customEdgesList: CustomEdge[] = [];

  if (includeCustom) {
    const allCustomNodes = storage.getCustomNodes();
    const allCustomEdges = storage.getCustomEdges();

    for (const cn of allCustomNodes) {
      customNodesList.push(cn);
      g.setNode(cn.id, { width: CUSTOM_WIDTH, height: CUSTOM_HEIGHT });
    }

    // Resolve custom edge references: edges may reference entity names, IDs, or dash-names
    const entityNameToId = new Map<string, string>();
    for (const entity of allEntities) {
      entityNameToId.set(entity.name.toLowerCase(), entity.id);
      entityNameToId.set(entity.name.toLowerCase().replace(/\s+/g, "-"), entity.id);
      entityNameToId.set(entity.id, entity.id);
    }
    for (const cn of customNodesList) {
      entityNameToId.set(cn.id, cn.id);
      entityNameToId.set(cn.label.toLowerCase(), cn.id);
      entityNameToId.set(cn.label.toLowerCase().replace(/\s+/g, "-"), cn.id);
    }

    for (const ce of allCustomEdges) {
      const resolvedSource = entityNameToId.get(ce.source) || entityNameToId.get(ce.source.toLowerCase());
      const resolvedTarget = entityNameToId.get(ce.target) || entityNameToId.get(ce.target.toLowerCase());
      if (resolvedSource && resolvedTarget) {
        // Check that both ends exist in the graph
        const sourceInGraph = entityIds.has(resolvedSource) || customNodesList.some((n) => n.id === resolvedSource);
        const targetInGraph = entityIds.has(resolvedTarget) || customNodesList.some((n) => n.id === resolvedTarget);
        if (sourceInGraph && targetInGraph) {
          customEdgesList.push({ ...ce, source: resolvedSource, target: resolvedTarget });
          g.setEdge(resolvedSource, resolvedTarget);
        }
      }
    }
  }

  // Apply entity overrides
  const overrides = storage.getEntityOverrides();

  // Inject virtual session nodes if requested
  interface VirtualSession {
    id: string;
    label: string;
    projectEntityId: string;
  }
  const virtualSessions: VirtualSession[] = [];

  if (includeSessions) {
    // Build map: decoded project path → entity id
    const projectEntities = allEntities.filter((e) => e.type === "project");
    const pathToEntityId = new Map<string, string>();
    for (const p of projectEntities) {
      pathToEntityId.set(p.path, p.id);
      // Also map by the last segment of the path for fuzzy matching
      const dirName = p.path.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop();
      if (dirName) pathToEntityId.set(dirName, p.id);
    }

    // Group sessions by projectKey and take top 20 per project
    const sessions = getCachedSessions();
    const grouped = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const arr = grouped.get(s.projectKey) || [];
      arr.push(s);
      grouped.set(s.projectKey, arr);
    }

    grouped.forEach((projectSessions, projectKey) => {
      const decoded = decodeProjectKey(projectKey);
      const dirName = decoded.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() || "";

      // Find matching project entity — exact match first
      let projectEntityId = pathToEntityId.get(decoded) || pathToEntityId.get(dirName);

      // If no exact match, check if session path is a parent of any project entity
      // (e.g. session in C:/Users/alice matches project at C:/Users/alice/myproject)
      // Attach to the first project entity found under this path
      if (!projectEntityId) {
        for (const p of projectEntities) {
          const pPath = p.path.replace(/\\/g, "/");
          if (pPath.startsWith(decoded + "/") && entityIds.has(p.id)) {
            projectEntityId = p.id;
            break;
          }
        }
      }

      if (!projectEntityId) return;
      if (!entityIds.has(projectEntityId)) return;

      // Take top 20 most recent
      const sorted = [...projectSessions]
        .sort((a, b) => (b.lastTs || "").localeCompare(a.lastTs || ""))
        .slice(0, 20);

      for (const s of sorted) {
        const nodeId = `session-${s.id}`;
        const label = (s.firstMessage || "(empty)").slice(0, 60);
        virtualSessions.push({ id: nodeId, label, projectEntityId });
        g.setNode(nodeId, { width: SESSION_WIDTH, height: SESSION_HEIGHT });
        g.setEdge(projectEntityId, nodeId);
      }
    });
  }

  dagre.layout(g);

  // Build parent mapping for grouping
  const parentMap = new Map<string, string>();
  if (groupParam) {
    for (const rel of filteredRels) {
      const sourceEntity = allEntities.find((e) => e.id === rel.sourceId);
      const targetEntity = allEntities.find((e) => e.id === rel.targetId);
      if (sourceEntity?.type === "project" && targetEntity && targetEntity.type !== "project") {
        parentMap.set(rel.targetId, rel.sourceId);
      }
    }
  }

  // Build response
  const nodes: GraphNode[] = allEntities.map((entity) => {
    const nodePos = g.node(entity.id);

    // Check for overrides by entity ID, name, or dash-separated name
    const dashName = entity.name.toLowerCase().replace(/\s+/g, "-");
    const override = overrides[entity.id] || overrides[entity.name] || overrides[entity.name.toLowerCase()] || overrides[dashName];

    const node: GraphNode = {
      id: entity.id,
      type: entity.type,
      label: override?.label || entity.name,
      description: override?.description || entity.description || undefined,
      health: entity.health,
      position: {
        x: nodePos?.x ?? 0,
        y: nodePos?.y ?? 0,
      },
      color: override?.color,
    };
    if (groupParam && parentMap.has(entity.id)) {
      node.parentId = parentMap.get(entity.id);
    }
    return node;
  });

  // Add custom nodes
  for (const cn of customNodesList) {
    const nodePos = g.node(cn.id);
    nodes.push({
      id: cn.id,
      type: "custom" as GraphNodeType,
      label: cn.label,
      description: cn.description,
      health: "unknown",
      position: { x: nodePos?.x ?? 0, y: nodePos?.y ?? 0 },
      subType: cn.subType,
      color: cn.color || CUSTOM_SUBTYPE_COLORS[cn.subType] || "#64748b",
      url: cn.url,
      source: cn.source,
    });
  }

  // Add virtual session nodes
  for (const vs of virtualSessions) {
    const nodePos = g.node(vs.id);
    nodes.push({
      id: vs.id,
      type: "session" as GraphNodeType,
      label: vs.label,
      health: "unknown",
      position: { x: nodePos?.x ?? 0, y: nodePos?.y ?? 0 },
    });
  }

  const edges = filteredRels.map((rel, i) => ({
    id: `e-${rel.sourceId}-${rel.targetId}-${rel.relation}-${i}`,
    source: rel.sourceId,
    target: rel.targetId,
    label: rel.relation,
    style: { ...EDGE_STYLES[rel.relation] || { color: "#94a3b8", strokeWidth: 1 }, animated: true },
  }));

  // Add session edges
  for (const vs of virtualSessions) {
    edges.push({
      id: `e-${vs.projectEntityId}-${vs.id}-has_session`,
      source: vs.projectEntityId,
      target: vs.id,
      label: "has_session",
      style: { ...EDGE_STYLES.has_session, animated: true },
    });
  }

  // Add custom edges
  for (const ce of customEdgesList) {
    const style = EDGE_STYLES[ce.label] || {
      color: ce.color || "#94a3b8",
      strokeWidth: 1.5,
      dashed: ce.dashed,
    };
    edges.push({
      id: ce.id,
      source: ce.source,
      target: ce.target,
      label: ce.label,
      style: { ...style, animated: true },
    });
  }

  const result: GraphData = { nodes, edges };
  res.json(result);
});

export default router;
