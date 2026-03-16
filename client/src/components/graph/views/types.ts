import type { GraphNode, GraphEdge } from "@shared/types";

export interface ViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick: (node: GraphNode) => void;
  searchQuery: string;
}
