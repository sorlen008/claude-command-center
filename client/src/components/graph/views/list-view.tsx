import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { entityConfig } from "@/components/entity-badge";
import { entityColors } from "@/components/graph/graph-nodes";
import { ArrowUpDown } from "lucide-react";
import type { GraphNode } from "@shared/types";
import type { ViewProps } from "./types";

type SortKey = "label" | "type" | "connections" | "health";
type SortDir = "asc" | "desc";

function isMatch(node: GraphNode, query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  return (
    node.label.toLowerCase().includes(q) ||
    (node.description?.toLowerCase().includes(q) ?? false)
  );
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentSort === sortKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors ${
        active ? "text-foreground" : "text-muted-foreground"
      } ${className || ""}`}
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${active ? "opacity-100" : "opacity-40"}`} />
      {active && (
        <span className="text-[9px]">{currentDir === "asc" ? "\u2191" : "\u2193"}</span>
      )}
    </button>
  );
}

export default function ListView({ nodes, edges, onNodeClick, searchQuery }: ViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const connectionMap = useMemo(() => {
    const map = new Map<string, { count: number; types: Set<string> }>();
    for (const node of nodes) {
      map.set(node.id, { count: 0, types: new Set() });
    }
    for (const edge of edges) {
      const s = map.get(edge.source);
      const t = map.get(edge.target);
      const sourceNode = nodes.find((n) => n.id === edge.source);
      const targetNode = nodes.find((n) => n.id === edge.target);
      if (s) {
        s.count++;
        if (targetNode) s.types.add(targetNode.type);
      }
      if (t) {
        t.count++;
        if (sourceNode) t.types.add(sourceNode.type);
      }
    }
    return map;
  }, [nodes, edges]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let result = [...nodes];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          (n.description?.toLowerCase().includes(q) ?? false) ||
          n.type.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "label":
          return mul * a.label.localeCompare(b.label);
        case "type":
          return mul * a.type.localeCompare(b.type);
        case "connections":
          return (
            mul *
            ((connectionMap.get(a.id)?.count || 0) - (connectionMap.get(b.id)?.count || 0))
          );
        case "health":
          return mul * (a.health || "").localeCompare(b.health || "");
        default:
          return 0;
      }
    });
    return result;
  }, [nodes, searchQuery, sortKey, sortDir, connectionMap]);

  return (
    <ScrollArea className="h-full w-full">
      <div className="p-4">
        <div className="glass rounded-xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_100px_1fr_80px_60px] gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
            <SortHeader label="Name" sortKey="label" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            <SortHeader label="Type" sortKey="type" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Description</span>
            <SortHeader label="Conns" sortKey="connections" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="justify-center" />
            <SortHeader label="Health" sortKey="health" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} className="justify-center" />
          </div>

          {/* Rows */}
          {filtered.map((node) => {
            const color = entityColors[node.type] || "#64748b";
            const config = entityConfig[node.type as keyof typeof entityConfig];
            const Icon = config?.icon;
            const conn = connectionMap.get(node.id);
            const matched = isMatch(node, searchQuery);

            return (
              <button
                key={node.id}
                onClick={() => onNodeClick(node)}
                className="grid grid-cols-[1fr_100px_1fr_80px_60px] gap-3 px-4 py-2.5 w-full text-left border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                style={{
                  boxShadow: matched ? `inset 3px 0 0 ${color}` : undefined,
                }}
              >
                {/* Name */}
                <div className="flex items-center gap-2 min-w-0">
                  {Icon && <Icon className="w-4 h-4 shrink-0" style={{ color }} />}
                  <span className="text-sm text-foreground truncate">{node.label}</span>
                </div>

                {/* Type badge */}
                <div className="flex items-center">
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0"
                    style={{ borderColor: `${color}40`, color }}
                  >
                    {node.type}
                  </Badge>
                </div>

                {/* Description */}
                <span className="text-[11px] text-muted-foreground truncate self-center">
                  {node.description || "\u2014"}
                </span>

                {/* Connections */}
                <div className="flex items-center justify-center gap-1">
                  <span className="text-xs tabular-nums text-foreground">{conn?.count || 0}</span>
                  {conn && conn.types.size > 0 && (
                    <div className="flex gap-0.5 ml-1">
                      {Array.from(conn.types).map((t) => (
                        <span
                          key={t}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: entityColors[t] || "#64748b" }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Health */}
                <div className="flex items-center justify-center">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: node.health === "ok" ? "#22c55e" : "#64748b",
                    }}
                  />
                </div>
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No matching entities found.
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
