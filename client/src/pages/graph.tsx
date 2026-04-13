import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useGraphData } from "@/hooks/use-graph";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { EntityType, GraphNode, GraphNodeType } from "@shared/types";
import { entityConfig } from "@/components/entity-badge";
import { ProjectNode, EntityNode, SessionNode, CustomGraphNode, entityColors } from "@/components/graph/graph-nodes";
import { AnimatedEdge } from "@/components/graph/animated-edge";
import { AISuggestionButton } from "@/components/graph/ai-suggestions";
import {
  RotateCcw,
  FolderOpen,
  ExternalLink,
  Eye,
  EyeOff,
  Maximize2,
  Search,
  X,
  Tag,
  ArrowRight,
  Focus,
  MessageSquare,
  Box,
  Globe,
  Network,
  LayoutGrid,
  TreePine,
  List,
  Circle,
  Grid3X3,
  Map as MapIcon,
  ChevronsUpDown,
} from "lucide-react";
import { useLocation } from "wouter";
import { GroupedTiles, TreeView, ListView, RadialView, MatrixView } from "@/components/graph/views";

// ------ Edge legend config ------

const EDGE_LEGEND: Record<string, { color: string; label: string }> = {
  uses_mcp:        { color: "#22c55e", label: "Uses MCP" },
  defines_mcp:     { color: "#3b82f6", label: "Defines" },
  has_skill:       { color: "#f97316", label: "Has Skill" },
  has_memory:      { color: "#a78bfa", label: "Has Memory" },
  has_claude_md:   { color: "#60a5fa", label: "Claude MD" },
  has_docs:        { color: "#94a3b8", label: "Has Docs" },
  provides_mcp:    { color: "#c084fc", label: "Provides MCP" },
  serves_data_for: { color: "#f59e0b", label: "Serves Data" },
  syncs:           { color: "#34d399", label: "Syncs" },
  has_session:     { color: "#06b6d4", label: "Sessions" },
  connects_to:     { color: "#f59e0b", label: "Connects To" },
  depends_on:      { color: "#ef4444", label: "Depends On" },
  uses:            { color: "#f97316", label: "Uses" },
  shares_remote:   { color: "#34d399", label: "Shared Remote" },
  uses_api:        { color: "#f59e0b", label: "Uses API" },
};

// ------ Node & Edge types ------

const nodeTypes: NodeTypes = {
  projectNode: ProjectNode,
  entityNode: EntityNode,
  sessionNode: SessionNode,
  customNode: CustomGraphNode,
};

const edgeTypes: EdgeTypes = {
  animated: AnimatedEdge,
};

type ViewMode = "graph" | "tiles" | "tree" | "list" | "radial" | "matrix";
const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: React.ElementType }[] = [
  { mode: "graph", label: "Graph", icon: Network },
  { mode: "tiles", label: "Tiles", icon: LayoutGrid },
  { mode: "tree", label: "Tree", icon: TreePine },
  { mode: "list", label: "List", icon: List },
  { mode: "radial", label: "Radial", icon: Circle },
  { mode: "matrix", label: "Matrix", icon: Grid3X3 },
];

const allEntityTypes: EntityType[] = ["project", "mcp", "skill", "plugin", "markdown", "config"];
const allGraphTypes: { type: string; label: string; icon: any; color: string }[] = [
  ...allEntityTypes.map((t) => ({ type: t, label: entityConfig[t].label, icon: entityConfig[t].icon, color: entityColors[t] })),
  { type: "session", label: "Sessions", icon: MessageSquare, color: "#06b6d4" },
  { type: "custom", label: "Custom", icon: Box, color: "#f59e0b" },
  { type: "api", label: "APIs", icon: Globe, color: "#f97316" },
];

export default function GraphPage() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem("graph-view") as ViewMode) || "graph"; } catch { return "graph"; }
  });
  const [activeTypes, setActiveTypes] = useState<string[]>(["project", "mcp", "skill", "plugin", "custom", "api"]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [legendVisible, setLegendVisible] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [edgeLabelsVisible, setEdgeLabelsVisible] = useState(false);
  const [layoutDir, setLayoutDir] = useState<"TB" | "LR">(() => {
    try { return (localStorage.getItem("graph-layout") as "TB" | "LR") || "TB"; } catch { return "TB"; }
  });
  const [minimapVisible, setMinimapVisible] = useState<boolean>(() => {
    try { return localStorage.getItem("graph-minimap") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("graph-minimap", minimapVisible ? "1" : "0"); } catch {}
  }, [minimapVisible]);

  // Focus Lens: by default, hide everything except the focused node and its
  // 1-2 hop neighborhood. With dense graphs (e.g. 1000+ edges) the full graph
  // is fundamentally unrenderable cleanly — the lens makes it readable. The
  // user can click "Show all" to escape the lens.
  const [showAll, setShowAll] = useState<boolean>(() => {
    try { return localStorage.getItem("graph-show-all") === "1"; } catch { return false; }
  });
  const [focusDepth, setFocusDepth] = useState<number>(() => {
    try { const v = parseInt(localStorage.getItem("graph-focus-depth") || "1", 10); return v >= 1 && v <= 3 ? v : 1; } catch { return 1; }
  });
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusPickerOpen, setFocusPickerOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("graph-show-all", showAll ? "1" : "0"); } catch {}
  }, [showAll]);
  useEffect(() => {
    try { localStorage.setItem("graph-focus-depth", String(focusDepth)); } catch {}
  }, [focusDepth]);

  // Mark the body while the graph is mounted so CSS can opt out of expensive
  // always-on effects (backdrop-blur on the toolbar, gradient-drift on the
  // root background). These animations cost per-frame compositor work that
  // the graph's pan/zoom cannot afford.
  useEffect(() => {
    document.body.classList.add("graph-active");
    return () => document.body.classList.remove("graph-active");
  }, []);
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);
  const interactingTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const getRfEl = () => reactFlowWrapperRef.current?.querySelector(".react-flow") as HTMLElement | null;
  // Single heartbeat handler: on every viewport tick (drag pan OR wheel zoom OR
  // pinch), add `is-panning` and reset a 200ms removal timer. Class stays on
  // as long as movement is happening and clears 200ms after the last tick.
  // This closes the wheel-zoom gap that onMoveStart/onMoveEnd couldn't cover.
  const onMove = useCallback(() => {
    const el = getRfEl();
    if (el && !el.classList.contains("is-panning")) el.classList.add("is-panning");
    if (interactingTimerRef.current) clearTimeout(interactingTimerRef.current);
    interactingTimerRef.current = setTimeout(() => {
      const el2 = getRfEl();
      if (el2) el2.classList.remove("is-panning");
    }, 200);
  }, []);
  // "api" is a client-side filter (subType of custom), not a server type.
  // Ensure "custom" is in the server request when "api" is active.
  const serverTypes = useMemo(() => {
    const types = activeTypes.filter((t) => t !== "api");
    if (activeTypes.includes("api") && !types.includes("custom")) {
      types.push("custom");
    }
    return types;
  }, [activeTypes]);
  const showApis = activeTypes.includes("api");
  const { data: rawGraphData, isLoading } = useGraphData(serverTypes);

  // Filter out API nodes client-side when toggle is off
  const graphData = useMemo(() => {
    if (!rawGraphData || showApis) return rawGraphData;
    const apiNodeIds = new Set(
      rawGraphData.nodes.filter((n) => n.subType === "api").map((n) => n.id)
    );
    return {
      nodes: rawGraphData.nodes.filter((n) => !apiNodeIds.has(n.id)),
      edges: rawGraphData.edges.filter((e) => !apiNodeIds.has(e.source) && !apiNodeIds.has(e.target)),
    };
  }, [rawGraphData, showApis]);
  const [, setLocation] = useLocation();
  const [rfInstance, setRfInstance] = useState<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  // Save layout preferences
  useEffect(() => {
    try { localStorage.setItem("graph-layout", layoutDir); } catch {}
  }, [layoutDir]);
  useEffect(() => {
    try { localStorage.setItem("graph-view", viewMode); } catch {}
  }, [viewMode]);

  const toggleType = (type: string) => {
    setActiveTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const resetTypes = () => {
    setActiveTypes(["project", "mcp", "skill", "plugin", "custom", "api"]);
    setSelectedNode(null);
    setSearchQuery("");
  };

  // Compute connection counts
  const connectionCounts = useMemo(() => {
    if (!graphData) return {};
    const counts: Record<string, number> = {};
    for (const edge of graphData.edges) {
      counts[edge.source] = (counts[edge.source] || 0) + 1;
      counts[edge.target] = (counts[edge.target] || 0) + 1;
    }
    return counts;
  }, [graphData]);

  // Hard cap on how many nodes the Focus Lens shows at once. Even at depth=1,
  // a hub node can have 100+ neighbors — capping keeps the screen readable.
  const LENS_NODE_CAP = 40;

  // Auto-pick the initial focus when data loads or focus disappears. We pick
  // a project node by preference, otherwise the median-connection node — NOT
  // the highest-connection hub, because anchoring on a hub defeats the lens.
  useEffect(() => {
    if (!graphData) return;
    const stillExists = focusNodeId && graphData.nodes.some((n) => n.id === focusNodeId);
    if (stillExists) return;
    const projects = graphData.nodes.filter((n) => n.type === "project");
    if (projects.length > 0) {
      // Pick the project with the most connections — projects are natural anchors
      let best = projects[0];
      let bestC = connectionCounts[best.id] || 0;
      for (const p of projects) {
        const c = connectionCounts[p.id] || 0;
        if (c > bestC) { best = p; bestC = c; }
      }
      setFocusNodeId(best.id);
    } else {
      setFocusNodeId(graphData.nodes[0]?.id ?? null);
    }
  }, [graphData, connectionCounts, focusNodeId]);

  // Focus Lens BFS: collect the focused node plus its `focusDepth`-hop
  // neighborhood, hard-capped at LENS_NODE_CAP. When the cap is hit, prefer
  // higher-connection neighbors so the visible set is the most informative
  // slice of the graph. Bypassed when showAll is true or search is active.
  const lensSubgraph = useMemo(() => {
    if (showAll || debouncedSearch || !graphData || !focusNodeId) return null;
    const visibleNodes = new Set<string>([focusNodeId]);
    let frontier = new Set<string>([focusNodeId]);
    for (let hop = 0; hop < focusDepth && visibleNodes.size < LENS_NODE_CAP; hop++) {
      // Collect candidate next-hop neighbors
      const candidates = new Set<string>();
      for (const e of graphData.edges) {
        if (frontier.has(e.source) && !visibleNodes.has(e.target)) candidates.add(e.target);
        if (frontier.has(e.target) && !visibleNodes.has(e.source)) candidates.add(e.source);
      }
      if (candidates.size === 0) break;
      // Sort candidates by connection count descending and take only enough to
      // stay within the cap.
      const slots = LENS_NODE_CAP - visibleNodes.size;
      const sorted = Array.from(candidates).sort(
        (a, b) => (connectionCounts[b] || 0) - (connectionCounts[a] || 0)
      );
      const next = new Set<string>(sorted.slice(0, slots));
      next.forEach((id) => visibleNodes.add(id));
      frontier = next;
      if (visibleNodes.size >= LENS_NODE_CAP) break;
    }
    // Collect every edge whose endpoints are both inside the visible set
    const visibleEdges = new Set<string>();
    for (const e of graphData.edges) {
      if (visibleNodes.has(e.source) && visibleNodes.has(e.target)) {
        visibleEdges.add(e.id);
      }
    }
    return { nodes: visibleNodes, edges: visibleEdges };
  }, [showAll, debouncedSearch, graphData, focusNodeId, focusDepth]);

  // Apply the lens to the data that everything downstream consumes. Crucially,
  // when in lens mode we OVERRIDE node positions and arrange the lens nodes
  // radially around the focus node — using the original dagre positions would
  // scatter the lens nodes across the full 263-node layout coordinates,
  // leaving only one node in the viewport.
  const visibleData = useMemo(() => {
    if (!graphData) return graphData;
    if (!lensSubgraph) return graphData;
    const focusNode = graphData.nodes.find((n) => n.id === focusNodeId);
    if (!focusNode) return graphData;
    const focusX = focusNode.position.x;
    const focusY = focusNode.position.y;
    const lensNodesArr = graphData.nodes.filter((n) => lensSubgraph.nodes.has(n.id));
    const neighbors = lensNodesArr.filter((n) => n.id !== focusNodeId);
    // Radius scales with neighbor count so they don't overlap. Each node is
    // ~240px wide; aim for ~340px circumference per node along the ring.
    const radius = Math.max(380, (neighbors.length * 90) / (2 * Math.PI));
    const positioned = lensNodesArr.map((n, _idx) => {
      if (n.id === focusNodeId) return { ...n, position: { x: focusX, y: focusY } };
      const i = neighbors.findIndex((nn) => nn.id === n.id);
      const angle = (i / neighbors.length) * 2 * Math.PI - Math.PI / 2;
      return {
        ...n,
        position: {
          x: focusX + radius * Math.cos(angle),
          y: focusY + radius * Math.sin(angle),
        },
      };
    });
    return {
      nodes: positioned,
      edges: graphData.edges.filter((e) => lensSubgraph.edges.has(e.id)),
    };
  }, [graphData, lensSubgraph, focusNodeId]);

  // Search matching
  const searchMatchIds = useMemo(() => {
    if (!debouncedSearch || !graphData) return new Set<string>();
    const q = debouncedSearch.toLowerCase();
    return new Set(
      graphData.nodes
        .filter((n) => n.label.toLowerCase().includes(q) || (n.description || "").toLowerCase().includes(q))
        .map((n) => n.id)
    );
  }, [debouncedSearch, graphData]);

  // Auto-pan to first search match
  useEffect(() => {
    if (searchMatchIds.size > 0 && rfInstance && graphData) {
      const firstMatch = graphData.nodes.find((n) => searchMatchIds.has(n.id));
      if (firstMatch) {
        rfInstance.setCenter(firstMatch.position.x, firstMatch.position.y, { zoom: 1.5, duration: 500 });
      }
    }
  }, [searchMatchIds, rfInstance, graphData]);

  // BFS for path highlighting from selected node
  const { pathNodeIds, pathEdgeIds } = useMemo(() => {
    if (!selectedNode || !graphData) return { pathNodeIds: new Set<string>(), pathEdgeIds: new Set<string>() };
    const nIds = new Set<string>([selectedNode.id]);
    const eIds = new Set<string>();
    // BFS through edges
    const queue = [selectedNode.id];
    const visited = new Set<string>([selectedNode.id]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of graphData.edges) {
        if (e.source === current && !visited.has(e.target)) {
          visited.add(e.target);
          nIds.add(e.target);
          eIds.add(e.id);
          queue.push(e.target);
        }
        if (e.target === current && !visited.has(e.source)) {
          visited.add(e.source);
          nIds.add(e.source);
          eIds.add(e.id);
          queue.push(e.source);
        }
      }
    }
    return { pathNodeIds: nIds, pathEdgeIds: eIds };
  }, [selectedNode, graphData]);

  const nodes: Node[] = useMemo(
    () =>
      (visibleData?.nodes || []).map((node) => {
        let nodeType: string;
        if (node.type === "session") nodeType = "sessionNode";
        else if (node.type === "project") nodeType = "projectNode";
        else if (node.type === "custom") nodeType = "customNode";
        else nodeType = "entityNode";

        return {
          id: node.id,
          type: nodeType,
          position: node.position,
          data: {
            ...node,
            connectionCount: connectionCounts[node.id] || 0,
            searchMatch: searchMatchIds.has(node.id),
            layoutDir,
            isFocus: node.id === focusNodeId,
          } as unknown as Record<string, unknown>,
        };
      }),
    [visibleData?.nodes, connectionCounts, searchMatchIds, layoutDir, focusNodeId]
  );

  // Client-side edge filtering
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const { edges: rawEdges, edgeLabelsInView } = useMemo(() => {
    const labelSet = new Set<string>();
    const edgeList: Edge[] = (visibleData?.edges || [])
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => {
        labelSet.add(edge.label);
        const s = edge.style || { color: "#94a3b8", strokeWidth: 1 };
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "animated",
          label: edgeLabelsVisible ? edge.label.replace(/_/g, " ") : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, color: s.color, width: 12, height: 12 },
          style: {
            stroke: s.color,
            strokeWidth: s.strokeWidth,
            ...(s.dotted ? { strokeDasharray: "3 3" } : s.dashed ? { strokeDasharray: "8 4" } : {}),
          },
          labelStyle: { fill: s.color, fontSize: 10, fontWeight: 500 },
          labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.85 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
        };
      });
    return { edges: edgeList, edgeLabelsInView: labelSet };
  }, [visibleData?.edges, nodeIds, edgeLabelsVisible]);

  // 1-hop neighbors of either the hovered or the selected node. We deliberately
  // do NOT use the full BFS pathNodeIds for the hover-dim style — that's kept
  // only for the Blast Radius count in the detail sheet. Using 1-hop for the
  // style tag keeps the injected CSS small even when a hub node is selected.
  const focusedId = hoveredNodeId ?? selectedNode?.id ?? null;
  const connectedIds = useMemo(() => {
    if (!focusedId) return null;
    const nIds = new Set<string>([focusedId]);
    const eIds = new Set<string>();
    for (const e of rawEdges) {
      if (e.source === focusedId || e.target === focusedId) {
        nIds.add(e.source);
        nIds.add(e.target);
        eIds.add(e.id);
      }
    }
    return { nodeIds: nIds, edgeIds: eIds };
  }, [focusedId, rawEdges]);

  // Small CSS block for dim+highlight. Bounded in size by the 1-hop neighbor
  // count of the focused node, regardless of how deep the blast radius goes.
  const hoverStyleTag = useMemo(() => {
    if (!connectedIds) return null;
    const nodeSelectors = Array.from(connectedIds.nodeIds).map((id) => `.react-flow__node[data-id="${id}"] .graph-node`).join(",\n");
    const edgeSelectors = Array.from(connectedIds.edgeIds).map((id) => `.react-flow__edge[data-id="${id}"] path`).join(",\n");
    return `
      .react-flow__node .graph-node { opacity: 0.15; transition: opacity 0.2s ease, box-shadow 0.2s ease; }
      .react-flow__edge path { opacity: 0.06; transition: opacity 0.2s ease; }
      ${nodeSelectors} { opacity: 1; box-shadow: 0 0 0 1.5px rgba(255,255,255,0.1), 0 0 16px rgba(59,130,246,0.15); }
      ${edgeSelectors ? `${edgeSelectors} { opacity: 1; filter: drop-shadow(0 0 6px currentColor); stroke-dashoffset: 0; animation: edge-flow 1s linear infinite; }` : ""}
    `;
  }, [connectedIds]);

  // Stable references — never recreated on hover
  const styledNodes = nodes;
  const styledEdges = rawEdges;

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const data = node.data as unknown as GraphNode;
    setSelectedNode(data);
    // Re-center the lens on the clicked node when not showing all
    if (!showAll) setFocusNodeId(node.id);
  }, [showAll]);

  const hoverIdleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const onNodeMouseEnter: NodeMouseHandler = useCallback((_event, node) => {
    if (hoverIdleTimerRef.current) clearTimeout(hoverIdleTimerRef.current);
    hoverIdleTimerRef.current = setTimeout(() => setHoveredNodeId(node.id), 60);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    if (hoverIdleTimerRef.current) clearTimeout(hoverIdleTimerRef.current);
    hoverIdleTimerRef.current = setTimeout(() => setHoveredNodeId(null), 60);
  }, []);

  const handleFitView = useCallback(() => {
    rfInstance?.fitView({ padding: 0.1, maxZoom: 2 });
  }, [rfInstance]);

  // Auto-fit / re-center when data, focus, or lens state changes. In lens
  // mode we center on the focus node at normal zoom — fitting to the bounding
  // box of a sparse subset of the original layout would produce a tiny graph
  // surrounded by empty space. In show-all mode we fit the whole thing.
  useEffect(() => {
    if (!rfInstance || nodes.length === 0) return;
    const t = setTimeout(() => {
      if (lensSubgraph && focusNodeId) {
        const focusNode = nodes.find((n) => n.id === focusNodeId);
        if (focusNode) {
          rfInstance.setCenter(focusNode.position.x, focusNode.position.y, { zoom: 0.9, duration: 400 });
          return;
        }
      }
      rfInstance.fitView({ padding: 0.1, maxZoom: 2, duration: 300 });
    }, 100);
    return () => clearTimeout(t);
  }, [rfInstance, nodes, lensSubgraph, focusNodeId]);

  const navigateToEntity = (node?: GraphNode) => {
    const target = node || selectedNode;
    if (!target) return;
    switch (target.type) {
      case "project": setLocation(`/projects/${target.id}`); break;
      case "mcp": setLocation("/mcps"); break;
      case "skill": setLocation("/skills"); break;
      case "plugin": setLocation("/plugins"); break;
      case "markdown": setLocation(`/markdown/${target.id}`); break;
      case "config": setLocation("/config"); break;
      case "session": setLocation("/sessions"); break;
      case "custom": break; // Custom nodes don't have a dedicated page
    }
  };

  const focusNode = useCallback((nodeId: string) => {
    if (!rfInstance || !graphData) return;
    const node = graphData.nodes.find((n) => n.id === nodeId);
    if (node) {
      rfInstance.setCenter(node.position.x, node.position.y, { zoom: 1.8, duration: 400 });
    }
  }, [rfInstance, graphData]);

  // Count edges for selected node — memoized so sheet re-renders don't re-scan
  const selectedEdges = useMemo(
    () => selectedNode ? rawEdges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id) : [],
    [selectedNode, rawEdges]
  );

  // Per-type counts for the toolbar filter buttons — pre-computed once instead
  // of running up to 7 Array.filter passes on every GraphPage render.
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      const t = (n.data as unknown as GraphNode).type;
      counts[t] = (counts[t] || 0) + 1;
    }
    counts.api = (rawGraphData?.nodes || []).filter((n) => n.subType === "api").length;
    return counts;
  }, [nodes, rawGraphData?.nodes]);

  // Blast-radius counts by type — memoized once per selectedNode change instead
  // of computed inside an IIFE in JSX on every render of the detail sheet.
  const blastCounts = useMemo(() => {
    if (!selectedNode || !graphData || pathNodeIds.size <= 1) return null;
    const counts: Record<string, number> = {};
    for (const id of Array.from(pathNodeIds)) {
      if (id === selectedNode.id) continue;
      const n = graphData.nodes.find((nn) => nn.id === id);
      if (n) counts[n.type] = (counts[n.type] || 0) + 1;
    }
    return counts;
  }, [selectedNode, graphData, pathNodeIds]);

  // Get connected nodes for detail panel
  const selectedConnections = useMemo(() => {
    if (!selectedNode || !graphData) return [];
    const connected: { node: GraphNode; relation: string; direction: "in" | "out" }[] = [];
    for (const edge of graphData.edges) {
      if (edge.source === selectedNode.id) {
        const target = graphData.nodes.find((n) => n.id === edge.target);
        if (target) connected.push({ node: target, relation: edge.label, direction: "out" });
      }
      if (edge.target === selectedNode.id) {
        const source = graphData.nodes.find((n) => n.id === edge.source);
        if (source) connected.push({ node: source, relation: edge.label, direction: "in" });
      }
    }
    return connected;
  }, [selectedNode, graphData]);

  // Legend items filtered to what's in view
  const legendItems = useMemo(() => {
    return Object.entries(EDGE_LEGEND).filter(([key]) => edgeLabelsInView.has(key));
  }, [edgeLabelsInView]);

  // Focus picker: all nodes from the FULL graph (not the lens), grouped by
  // type, sorted by connection count descending so the most-connected entries
  // surface first. Used to populate the searchable dropdown.
  const focusPickerGroups = useMemo(() => {
    if (!graphData) return [] as { type: string; nodes: GraphNode[] }[];
    const byType: Record<string, GraphNode[]> = {};
    for (const n of graphData.nodes) {
      (byType[n.type] ||= []).push(n);
    }
    const orderedTypes = ["project", "mcp", "skill", "plugin", "custom", "session", "markdown", "config"];
    return orderedTypes
      .filter((t) => byType[t]?.length)
      .map((t) => ({
        type: t,
        nodes: byType[t].sort((a, b) => (connectionCounts[b.id] || 0) - (connectionCounts[a.id] || 0)),
      }));
  }, [graphData, connectionCounts]);

  const focusNodeLabel = useMemo(() => {
    if (!graphData || !focusNodeId) return "";
    return graphData.nodes.find((n) => n.id === focusNodeId)?.label || "";
  }, [graphData, focusNodeId]);

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-card/50 backdrop-blur">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Entity Graph</h1>
          <span className="text-xs text-muted-foreground tabular-nums">
            {nodes.length} nodes, {styledEdges.length} edges
            {graphData && lensSubgraph && (
              <span className="text-purple-400/80 ml-1">(of {graphData.nodes.length}/{graphData.edges.length})</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode selector */}
          <div className="flex items-center bg-muted/50 rounded-md p-0.5">
            {VIEW_OPTIONS.map(({ mode, label, icon: VIcon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                  viewMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={label}
              >
                <VIcon className="h-3 w-3" />
                <span className="hidden xl:inline">{label}</span>
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-border" />

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-40 pl-7 text-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="w-px h-5 bg-border" />

          {/* Focus Lens controls */}
          <div className="flex items-center gap-1">
            <Button
              variant={showAll ? "outline" : "default"}
              size="sm"
              className="h-7 text-xs gap-1"
              style={!showAll ? { backgroundColor: "#a855f7", borderColor: "#a855f7", color: "white" } : {}}
              onClick={() => setShowAll((v) => !v)}
              title={showAll ? "Switch to Focus mode (faster)" : "Show all nodes (may be slow)"}
            >
              <Focus className="h-3 w-3" />
              {showAll ? "Show all" : "Focus"}
            </Button>
            {!showAll && (
              <>
                <div className="flex items-center bg-muted/50 rounded-md p-0.5">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      onClick={() => setFocusDepth(d)}
                      className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                        focusDepth === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      title={`Show ${d}-hop neighborhood`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                {/* Focus picker — pick any node from the full graph */}
                <Popover open={focusPickerOpen} onOpenChange={setFocusPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5 max-w-[200px]"
                      title="Pick any node to focus on"
                    >
                      <span className="truncate">{focusNodeLabel || "Pick focus..."}</span>
                      <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Search any entity..." className="text-xs" />
                      <CommandList className="max-h-[400px]">
                        <CommandEmpty>No entities found.</CommandEmpty>
                        {focusPickerGroups.map((group) => (
                          <CommandGroup key={group.type} heading={`${group.type} (${group.nodes.length})`}>
                            {group.nodes.map((node) => {
                              const c = connectionCounts[node.id] || 0;
                              return (
                                <CommandItem
                                  key={node.id}
                                  value={`${node.label} ${node.id}`}
                                  onSelect={() => {
                                    setFocusNodeId(node.id);
                                    setFocusPickerOpen(false);
                                  }}
                                  className="text-xs"
                                >
                                  <span
                                    className="w-2 h-2 rounded-full mr-2 shrink-0"
                                    style={{ backgroundColor: entityColors[node.type] || "#64748b" }}
                                  />
                                  <span className="truncate flex-1">{node.label}</span>
                                  <span className="text-[10px] text-muted-foreground ml-2 tabular-nums">{c}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </>
            )}
          </div>

          <div className="w-px h-5 bg-border" />

          {/* Type filters */}
          {allGraphTypes.map(({ type, label, icon: Icon, color }) => {
            const active = activeTypes.includes(type);
            const count = typeCounts[type] || 0;
            return (
              <Button
                key={type}
                variant={active ? "default" : "outline"}
                size="sm"
                className="text-xs gap-1 h-7"
                style={active ? { backgroundColor: color, borderColor: color, color: "white" } : {}}
                onClick={() => toggleType(type)}
                aria-label={`Toggle ${label}`}
              >
                <Icon className="h-3 w-3" />
                {label}
                {active && count > 0 && (
                  <span className="ml-0.5 opacity-80 tabular-nums">{count}</span>
                )}
              </Button>
            );
          })}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetTypes} title="Reset filters" aria-label="Reset filters">
            <RotateCcw className="h-3 w-3" />
          </Button>
          <div className="w-px h-5 bg-border" />

          {/* AI Suggestions */}
          <AISuggestionButton onAccepted={() => {
            // Trigger a rescan to refresh graph data
            fetch("/api/scanner/rescan", { method: "POST" }).then(() => {
              // React Query will pick up fresh data
              window.location.reload();
            });
          }} />

          {/* Layout direction */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setLayoutDir((d) => d === "TB" ? "LR" : "TB")}
            title={`Layout: ${layoutDir}`}
            aria-label="Toggle layout direction"
          >
            <ArrowRight className={`h-3 w-3 transition-transform ${layoutDir === "TB" ? "rotate-90" : ""}`} />
            {layoutDir}
          </Button>

          {/* Edge labels toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setEdgeLabelsVisible((v) => !v)}
            title={edgeLabelsVisible ? "Hide edge labels" : "Show edge labels"}
            aria-label="Toggle edge labels"
          >
            <Tag className={`h-3.5 w-3.5 ${edgeLabelsVisible ? "text-blue-400" : ""}`} />
          </Button>

          <Button variant="ghost" size="sm" className="h-7" onClick={() => setLegendVisible((v) => !v)} title="Toggle legend" aria-label="Toggle legend">
            {legendVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setMinimapVisible((v) => !v)}
            title={minimapVisible ? "Hide minimap (faster pan/zoom)" : "Show minimap"}
            aria-label="Toggle minimap"
          >
            <MapIcon className={`h-3.5 w-3.5 ${minimapVisible ? "text-blue-400" : ""}`} />
          </Button>
          <Button variant="ghost" size="sm" className="h-7" onClick={handleFitView} title="Fit view" aria-label="Fit view">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 relative" style={{ minHeight: 400 }} ref={reactFlowWrapperRef}>

        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <span className="text-sm">Loading graph...</span>
            </div>
          </div>
        ) : viewMode === "graph" ? (
          <>
            {hoverStyleTag && <style dangerouslySetInnerHTML={{ __html: hoverStyleTag }} />}
            <ReactFlow
              nodes={styledNodes}
              edges={styledEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onInit={setRfInstance}
              onPaneClick={() => selectedNode && setSelectedNode(null)}
              onMove={onMove}
              minZoom={0.1}
              maxZoom={3}
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable={false}
              onlyRenderVisibleElements
              elevateNodesOnSelect={false}
              elevateEdgesOnSelect={false}
              nodeDragThreshold={4}
              disableKeyboardA11y
            >
              <Background gap={24} size={1} color="hsl(216 34% 17% / 0.5)" />
              <Controls
                showInteractive={false}
                className="!bg-card !border-border !shadow-lg"
              />
              {minimapVisible && (
                <MiniMap
                  nodeColor="#64748b"
                  maskColor="hsl(224 71% 4% / 0.8)"
                  style={{ backgroundColor: "hsl(224 71% 6%)", border: "1px solid hsl(216 34% 17%)" }}
                  zoomable={false}
                  pannable={false}
                />
              )}
            </ReactFlow>

            {/* Search results count */}
            {debouncedSearch && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 glass rounded-full px-3 py-1 text-xs text-muted-foreground border border-border/50 z-10">
                {searchMatchIds.size} match{searchMatchIds.size !== 1 ? "es" : ""} for "{debouncedSearch}"
              </div>
            )}

            {/* Edge Legend */}
            {legendVisible && legendItems.length > 0 && (
              <div className="absolute bottom-4 left-4 glass border rounded-lg p-3 shadow-lg max-w-[200px] z-10">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Connections
                </div>
                <div className="space-y-1.5">
                  {legendItems.map(([key, { color, label }]) => (
                    <div key={key} className="flex items-center gap-2">
                      <div className="w-5 h-0.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[11px] text-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="h-full overflow-auto">
            {viewMode === "tiles" && (
              <GroupedTiles
                nodes={graphData?.nodes || []}
                edges={graphData?.edges || []}
                onNodeClick={(node) => setSelectedNode(node)}
                searchQuery={debouncedSearch}
              />
            )}
            {viewMode === "tree" && (
              <TreeView
                nodes={graphData?.nodes || []}
                edges={graphData?.edges || []}
                onNodeClick={(node) => setSelectedNode(node)}
                searchQuery={debouncedSearch}
              />
            )}
            {viewMode === "list" && (
              <ListView
                nodes={graphData?.nodes || []}
                edges={graphData?.edges || []}
                onNodeClick={(node) => setSelectedNode(node)}
                searchQuery={debouncedSearch}
              />
            )}
            {viewMode === "radial" && (
              <RadialView
                nodes={graphData?.nodes || []}
                edges={graphData?.edges || []}
                onNodeClick={(node) => setSelectedNode(node)}
                searchQuery={debouncedSearch}
              />
            )}
            {viewMode === "matrix" && (
              <MatrixView
                nodes={graphData?.nodes || []}
                edges={graphData?.edges || []}
                onNodeClick={(node) => setSelectedNode(node)}
                searchQuery={debouncedSearch}
              />
            )}
          </div>
        )}
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedNode} onOpenChange={(open) => { if (!open) setSelectedNode(null); }}>
        <SheetContent className="w-[360px] sm:w-[400px] overflow-y-auto">
          {selectedNode && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = selectedNode.type === "session"
                      ? MessageSquare
                      : selectedNode.type === "custom"
                        ? Box
                        : entityConfig[selectedNode.type as EntityType]?.icon || FolderOpen;
                    const nodeColor = selectedNode.color || entityColors[selectedNode.type] || "#64748b";
                    return (
                      <div
                        className="flex items-center justify-center w-10 h-10 rounded-xl"
                        style={{ backgroundColor: `${nodeColor}15` }}
                      >
                        <Icon className="h-5 w-5" style={{ color: nodeColor }} />
                      </div>
                    );
                  })()}
                  <div>
                    <SheetTitle className="text-base">{selectedNode.label}</SheetTitle>
                    <SheetDescription className="sr-only">Details for {selectedNode.label}</SheetDescription>
                    <Badge
                      variant="outline"
                      className="text-[10px] mt-1"
                      style={{ borderColor: entityColors[selectedNode.type] || "#64748b", color: entityColors[selectedNode.type] || "#64748b" }}
                    >
                      {selectedNode.type}
                    </Badge>
                  </div>
                </div>
              </SheetHeader>

              {selectedNode.description && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">{selectedNode.description}</p>
              )}

              {/* Stats */}
              <div className="space-y-2 text-sm border-t border-border/50 pt-4 mb-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connections</span>
                  <span className="font-mono tabular-nums">{selectedEdges.length}</span>
                </div>
                {selectedNode.type !== "custom" && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Health</span>
                    <span className={`font-mono ${selectedNode.health === "ok" ? "text-green-400" : "text-yellow-400"}`}>
                      {selectedNode.health}
                    </span>
                  </div>
                )}
                {selectedNode.subType && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sub-type</span>
                    <span className="font-mono text-muted-foreground">{selectedNode.subType}</span>
                  </div>
                )}
                {selectedNode.source && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <span className="font-mono text-muted-foreground text-xs">{selectedNode.source}</span>
                  </div>
                )}
                {selectedNode.url && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">URL</span>
                    <span className="font-mono text-xs text-blue-400 truncate max-w-[180px]">{selectedNode.url}</span>
                  </div>
                )}
              </div>

              {/* Blast radius impact */}
              {blastCounts && (
                <div className="border-t border-border/50 pt-4 mb-4">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Blast Radius
                  </h4>
                  <p className="text-[11px] text-muted-foreground mb-2">
                    If this {selectedNode?.type || "entity"} changes, <span className="text-amber-400 font-medium">{pathNodeIds.size - 1}</span> entities are affected:
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Object.entries(blastCounts).map(([type, count]) => (
                      <span key={type} className="text-[10px] px-2 py-0.5 rounded-full border border-border/50 text-muted-foreground">
                        {count} {type}{count > 1 ? "s" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected nodes */}
              {selectedConnections.length > 0 && (
                <div className="border-t border-border/50 pt-4 mb-4">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Connected Entities ({selectedConnections.length})
                  </h4>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {selectedConnections.map(({ node, relation, direction }, i) => {
                      const Icon = node.type === "session" ? MessageSquare : node.type === "custom" ? Box : entityConfig[node.type as EntityType]?.icon || FolderOpen;
                      return (
                        <button
                          key={`${node.id}-${i}`}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors text-left"
                          onClick={() => {
                            setSelectedNode(node);
                            focusNode(node.id);
                          }}
                        >
                          <Icon className="h-3 w-3 shrink-0" style={{ color: entityColors[node.type] }} />
                          <span className="text-xs truncate flex-1">{node.label}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {direction === "out" ? "→" : "←"} {relation.replace(/_/g, " ")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs gap-1"
                  onClick={() => focusNode(selectedNode.id)}
                  aria-label="Focus on node"
                >
                  <Focus className="h-3 w-3" />
                  Focus
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs gap-1"
                  onClick={() => navigateToEntity()}
                  aria-label="View entity details"
                >
                  <ExternalLink className="h-3 w-3" />
                  View details
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
