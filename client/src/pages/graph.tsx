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
      (graphData?.nodes || []).map((node) => {
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
          } as unknown as Record<string, unknown>,
        };
      }),
    [graphData?.nodes, connectionCounts, searchMatchIds]
  );

  // Client-side edge filtering
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const { edges: rawEdges, edgeLabelsInView } = useMemo(() => {
    const labelSet = new Set<string>();
    const edgeList: Edge[] = (graphData?.edges || [])
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
          markerEnd: { type: MarkerType.ArrowClosed, color: s.color, width: 14, height: 14 },
          style: {
            stroke: s.color,
            strokeWidth: s.strokeWidth,
            strokeDasharray: s.dotted ? "3 3" : s.dashed ? "8 4" : "8 4",
          },
          labelStyle: { fill: s.color, fontSize: 10, fontWeight: 500 },
          labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.85 },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
        };
      });
    return { edges: edgeList, edgeLabelsInView: labelSet };
  }, [graphData?.edges, nodeIds, edgeLabelsVisible]);

  // Hover highlighting
  const { connectedNodeIds, connectedEdgeIds } = useMemo(() => {
    if (!hoveredNodeId) return { connectedNodeIds: new Set<string>(), connectedEdgeIds: new Set<string>() };
    const nIds = new Set<string>([hoveredNodeId]);
    const eIds = new Set<string>();
    for (const e of rawEdges) {
      if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
        nIds.add(e.source);
        nIds.add(e.target);
        eIds.add(e.id);
      }
    }
    return { connectedNodeIds: nIds, connectedEdgeIds: eIds };
  }, [hoveredNodeId, rawEdges]);

  // Apply dimming (hover takes priority, then selection path)
  const styledNodes = useMemo(() => {
    if (hoveredNodeId) {
      return nodes.map((n) => ({
        ...n,
        className: connectedNodeIds.has(n.id) ? "" : "dimmed",
      }));
    }
    if (selectedNode && pathNodeIds.size > 1) {
      return nodes.map((n) => ({
        ...n,
        className: pathNodeIds.has(n.id) ? "" : "dimmed",
      }));
    }
    return nodes;
  }, [nodes, hoveredNodeId, connectedNodeIds, selectedNode, pathNodeIds]);

  const styledEdges = useMemo(() => {
    if (hoveredNodeId) {
      return rawEdges.map((e) => ({
        ...e,
        className: connectedEdgeIds.has(e.id) ? "highlighted" : "dimmed",
      }));
    }
    if (selectedNode && pathEdgeIds.size > 0) {
      return rawEdges.map((e) => ({
        ...e,
        className: pathEdgeIds.has(e.id) ? "highlighted" : "dimmed",
      }));
    }
    return rawEdges;
  }, [rawEdges, hoveredNodeId, connectedEdgeIds, selectedNode, pathEdgeIds]);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const data = node.data as unknown as GraphNode;
    setSelectedNode(data);
  }, []);

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_event, node) => {
    setHoveredNodeId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const handleFitView = useCallback(() => {
    rfInstance?.fitView({ padding: 0.1, maxZoom: 2 });
  }, [rfInstance]);

  // Auto-fit when data loads
  useEffect(() => {
    if (rfInstance && nodes.length > 0) {
      setTimeout(() => rfInstance.fitView({ padding: 0.1, maxZoom: 2 }), 100);
    }
  }, [rfInstance, nodes.length]);

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

  // Count edges for selected node
  const selectedEdges = selectedNode
    ? rawEdges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
    : [];

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

  return (
    <div className="h-screen flex flex-col">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-card/50 backdrop-blur">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Entity Graph</h1>
          <span className="text-xs text-muted-foreground tabular-nums">
            {nodes.length} nodes, {styledEdges.length} edges
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

          {/* Type filters */}
          {allGraphTypes.map(({ type, label, icon: Icon, color }) => {
            const active = activeTypes.includes(type);
            const count = type === "api"
              ? (rawGraphData?.nodes || []).filter((n) => n.subType === "api").length
              : nodes.filter((n) => (n.data as unknown as GraphNode).type === type).length;
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
          <Button variant="ghost" size="sm" className="h-7" onClick={handleFitView} title="Fit view" aria-label="Fit view">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 relative" style={{ minHeight: 400 }}>
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <span className="text-sm">Loading graph...</span>
            </div>
          </div>
        ) : viewMode === "graph" ? (
          <>
            <ReactFlow
              nodes={styledNodes}
              edges={styledEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onInit={setRfInstance}
              onPaneClick={() => setSelectedNode(null)}
              fitView
              fitViewOptions={{ padding: 0.1, maxZoom: 2 }}
              minZoom={0.1}
              maxZoom={3}
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable={false}
            >
              <Background gap={24} size={1} color="hsl(216 34% 17% / 0.5)" />
              <Controls
                showInteractive={false}
                className="!bg-card !border-border !shadow-lg"
              />
              <MiniMap
                nodeColor="#64748b"
                maskColor="hsl(224 71% 4% / 0.8)"
                style={{ backgroundColor: "hsl(224 71% 6%)", border: "1px solid hsl(216 34% 17%)" }}
                zoomable={false}
                pannable={false}
              />
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
