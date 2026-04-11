import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { entityConfig } from "@/components/entity-badge";
import { entityColors } from "@/components/graph/graph-nodes";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { GraphNode } from "@shared/types";
import type { ViewProps } from "./types";

interface TreeChild {
  node: GraphNode;
  relationLabel: string;
}

function isMatch(node: GraphNode, query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  return (
    node.label.toLowerCase().includes(q) ||
    (node.description?.toLowerCase().includes(q) ?? false)
  );
}

function NodeRow({
  node,
  indent,
  relationLabel,
  searchQuery,
  onNodeClick,
}: {
  node: GraphNode;
  indent: number;
  relationLabel?: string;
  searchQuery: string;
  onNodeClick: (n: GraphNode) => void;
}) {
  const color = entityColors[node.type] || "#64748b";
  const config = entityConfig[node.type as keyof typeof entityConfig];
  const Icon = config?.icon;
  const matched = isMatch(node, searchQuery);

  return (
    <button
      onClick={() => onNodeClick(node)}
      className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-muted/40 rounded-md transition-colors cursor-pointer"
      style={{
        paddingLeft: `${indent * 24 + 12}px`,
        boxShadow: matched ? `inset 3px 0 0 ${color}` : undefined,
      }}
    >
      {Icon && (
        <div
          className="flex items-center justify-center w-6 h-6 rounded-md shrink-0"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-3 h-3" style={{ color }} />
        </div>
      )}
      <span className="text-sm text-foreground truncate">{node.label}</span>
      {node.health === "ok" && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "#22c55e" }} />
      )}
      {relationLabel && (
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{relationLabel}</span>
      )}
    </button>
  );
}

function ProjectTree({
  project,
  children,
  searchQuery,
  onNodeClick,
}: {
  project: GraphNode;
  children: TreeChild[];
  searchQuery: string;
  onNodeClick: (n: GraphNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const color = entityColors[project.type] || "#3b82f6";
  const matched = isMatch(project, searchQuery);

  return (
    <div className="mb-1">
      <div
        className="flex items-center gap-1 rounded-md hover:bg-muted/40 transition-colors"
        style={{
          boxShadow: matched ? `inset 3px 0 0 ${color}` : undefined,
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() => onNodeClick(project)}
          className="flex items-center gap-2 flex-1 py-1.5 pr-3 text-left cursor-pointer"
        >
          <span className="text-sm font-semibold text-foreground truncate">{project.label}</span>
          {project.health === "ok" && (
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "#22c55e" }} />
          )}
          <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
            {children.length}
          </Badge>
        </button>
      </div>
      {expanded && (
        <div className="ml-2 border-l border-border/50 pl-1">
          {children.map((child) => (
            <NodeRow
              key={child.node.id}
              node={child.node}
              indent={1}
              relationLabel={child.relationLabel}
              searchQuery={searchQuery}
              onNodeClick={onNodeClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TreeView({ nodes, edges, onNodeClick, searchQuery }: ViewProps) {
  const { projects, orphans } = useMemo(() => {
    const projectNodes = nodes.filter((n) => n.type === "project");
    const connectedIds = new Set<string>();
    const projectChildren = new Map<string, TreeChild[]>();

    for (const p of projectNodes) {
      projectChildren.set(p.id, []);
    }

    // Build node lookup map for O(1) access instead of O(n) find()
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    for (const edge of edges) {
      const projectId = projectChildren.has(edge.source)
        ? edge.source
        : projectChildren.has(edge.target)
          ? edge.target
          : null;

      if (projectId) {
        const childId = projectId === edge.source ? edge.target : edge.source;
        const childNode = nodeMap.get(childId);
        if (childNode) {
          projectChildren.get(projectId)!.push({
            node: childNode,
            relationLabel: edge.label,
          });
          connectedIds.add(childId);
        }
      }
    }

    // Mark project nodes as connected
    for (const p of projectNodes) {
      connectedIds.add(p.id);
    }

    const orphanNodes = nodes.filter((n) => !connectedIds.has(n.id));

    return {
      projects: projectNodes.map((p) => ({
        project: p,
        children: projectChildren.get(p.id) || [],
      })),
      orphans: orphanNodes,
    };
  }, [nodes, edges]);

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-4 space-y-1">
        {projects.map(({ project, children }) => (
          <ProjectTree
            key={project.id}
            project={project}
            children={children}
            searchQuery={searchQuery}
            onNodeClick={onNodeClick}
          />
        ))}

        {orphans.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 px-3 py-2 mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Unconnected
              </span>
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {orphans.length}
              </Badge>
            </div>
            <div className="ml-2 border-l border-border/30 pl-1">
              {orphans.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  indent={1}
                  searchQuery={searchQuery}
                  onNodeClick={onNodeClick}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
