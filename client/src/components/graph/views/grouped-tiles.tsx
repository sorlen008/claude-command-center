import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { entityConfig } from "@/components/entity-badge";
import { entityColors } from "@/components/graph/graph-nodes";
import type { GraphNode, GraphNodeType } from "@shared/types";
import type { ViewProps } from "./types";

function isMatch(node: GraphNode, query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  return (
    node.label.toLowerCase().includes(q) ||
    (node.description?.toLowerCase().includes(q) ?? false)
  );
}

export default function GroupedTiles({ nodes, edges, onNodeClick, searchQuery }: ViewProps) {
  // Pre-compute connection counts in O(e) instead of O(n*e)
  const connectionMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [edges]);
  const groups = useMemo(() => {
    const map = new Map<string, GraphNode[]>();
    for (const node of nodes) {
      const key = node.type;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(node);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-4 space-y-6">
        {groups.map(([type, groupNodes]) => {
          const color = entityColors[type] || "#64748b";
          const config = entityConfig[type as keyof typeof entityConfig];
          const Icon = config?.icon;
          const label = config?.label || type;

          return (
            <section key={type} className="glass rounded-xl overflow-hidden">
              <header
                className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
                style={{ borderTopColor: color, borderTopWidth: 2 }}
              >
                {Icon && <Icon className="w-4 h-4" style={{ color }} />}
                <span className="text-sm font-semibold text-foreground">{label}</span>
                <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
                  {groupNodes.length}
                </Badge>
              </header>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                {groupNodes.map((node) => {
                  const matched = isMatch(node, searchQuery);
                  const conns = connectionMap.get(node.id) ?? 0;

                  return (
                    <button
                      key={node.id}
                      onClick={() => onNodeClick(node)}
                      className="glass rounded-lg p-3 text-left transition-all hover:brightness-110 focus:outline-none cursor-pointer"
                      style={{
                        boxShadow: matched
                          ? `0 0 0 2px ${color}, 0 0 12px ${color}40`
                          : undefined,
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground truncate">
                          {node.label}
                        </span>
                        {node.health === "ok" && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: "#22c55e" }}
                          />
                        )}
                      </div>
                      {node.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2">
                          {node.description}
                        </p>
                      )}
                      {conns > 0 && (
                        <Badge variant="secondary" className="text-[10px] tabular-nums px-1.5 py-0">
                          {conns} conn{conns !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </ScrollArea>
  );
}
