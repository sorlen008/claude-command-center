import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { entityColors } from "@/components/graph/graph-nodes";
import { entityConfig } from "@/components/entity-badge";
import type { GraphNode } from "@shared/types";
import type { ViewProps } from "./types";

function isMatch(node: GraphNode, query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  return (
    node.label.toLowerCase().includes(q) ||
    (node.description?.toLowerCase().includes(q) ?? false)
  );
}

export default function MatrixView({ nodes, edges, onNodeClick, searchQuery }: ViewProps) {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  // Sort nodes by type for grouping
  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
      const typeCmp = a.type.localeCompare(b.type);
      if (typeCmp !== 0) return typeCmp;
      return a.label.localeCompare(b.label);
    });
  }, [nodes]);

  // Build adjacency lookup
  const adjacency = useMemo(() => {
    const map = new Map<string, { label: string; color: string }>();
    for (const edge of edges) {
      const key1 = `${edge.source}:${edge.target}`;
      const key2 = `${edge.target}:${edge.source}`;
      const color = edge.style?.color || "#64748b";
      map.set(key1, { label: edge.label, color });
      map.set(key2, { label: edge.label, color });
    }
    return map;
  }, [edges]);

  const CELL_SIZE = 28;
  const HEADER_SIZE = 120;

  if (sortedNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No entities to display.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <ScrollArea className="h-full w-full">
        <div className="p-4">
          <div className="glass rounded-xl overflow-hidden p-4">
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mb-4">
              {Object.entries(entityConfig).map(([type, config]) => {
                const color = entityColors[type] || "#64748b";
                return (
                  <div key={type} className="flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-[10px] text-muted-foreground">{config.label}</span>
                  </div>
                );
              })}
            </div>

            <div className="overflow-auto">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `${HEADER_SIZE}px repeat(${sortedNodes.length}, ${CELL_SIZE}px)`,
                  gridTemplateRows: `${HEADER_SIZE}px repeat(${sortedNodes.length}, ${CELL_SIZE}px)`,
                  gap: "1px",
                  width: "fit-content",
                }}
              >
                {/* Top-left empty corner */}
                <div />

                {/* Column headers */}
                {sortedNodes.map((node, colIdx) => {
                  const color = entityColors[node.type] || "#64748b";
                  const matched = isMatch(node, searchQuery);
                  return (
                    <div
                      key={`col-${node.id}`}
                      className="flex items-end justify-center pb-1 cursor-pointer"
                      style={{
                        width: CELL_SIZE,
                        height: HEADER_SIZE,
                        borderBottom: `2px solid ${matched ? color : "transparent"}`,
                      }}
                      onClick={() => onNodeClick(node)}
                    >
                      <span
                        className="text-[9px] text-muted-foreground whitespace-nowrap origin-bottom-left"
                        style={{
                          transform: "rotate(-60deg)",
                          transformOrigin: "center",
                          display: "block",
                          maxWidth: HEADER_SIZE - 10,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          color: hoveredCell?.col === colIdx ? color : undefined,
                        }}
                      >
                        {node.label}
                      </span>
                    </div>
                  );
                })}

                {/* Rows */}
                {sortedNodes.map((rowNode, rowIdx) => {
                  const rowColor = entityColors[rowNode.type] || "#64748b";
                  const rowMatched = isMatch(rowNode, searchQuery);

                  return (
                    <>
                      {/* Row header */}
                      <div
                        key={`row-${rowNode.id}`}
                        className="flex items-center gap-1.5 pr-2 cursor-pointer hover:bg-muted/30 rounded-l-md transition-colors"
                        style={{
                          height: CELL_SIZE,
                          borderLeft: `2px solid ${rowMatched ? rowColor : "transparent"}`,
                        }}
                        onClick={() => onNodeClick(rowNode)}
                      >
                        <span
                          className="w-2 h-2 rounded-sm shrink-0 ml-1"
                          style={{ backgroundColor: rowColor }}
                        />
                        <span
                          className="text-[10px] truncate"
                          style={{
                            color:
                              hoveredCell?.row === rowIdx
                                ? "hsl(var(--foreground))"
                                : "hsl(var(--muted-foreground))",
                          }}
                        >
                          {rowNode.label}
                        </span>
                      </div>

                      {/* Cells */}
                      {sortedNodes.map((colNode, colIdx) => {
                        const key = `${rowNode.id}:${colNode.id}`;
                        const relation = adjacency.get(key);
                        const isDiagonal = rowIdx === colIdx;
                        const isHovered =
                          hoveredCell?.row === rowIdx && hoveredCell?.col === colIdx;

                        return (
                          <Tooltip key={key}>
                            <TooltipTrigger asChild>
                              <div
                                className={`transition-all ${
                                  relation ? "cursor-pointer" : ""
                                }`}
                                style={{
                                  width: CELL_SIZE,
                                  height: CELL_SIZE,
                                  backgroundColor: isDiagonal
                                    ? `${rowColor}15`
                                    : relation
                                      ? `${relation.color}${isHovered ? "60" : "35"}`
                                      : hoveredCell?.row === rowIdx || hoveredCell?.col === colIdx
                                        ? "hsl(var(--muted) / 0.3)"
                                        : "transparent",
                                  borderRadius: 3,
                                  border: isHovered && relation ? `1px solid ${relation.color}` : "1px solid transparent",
                                }}
                                onMouseEnter={() => setHoveredCell({ row: rowIdx, col: colIdx })}
                                onMouseLeave={() => setHoveredCell(null)}
                                onClick={() => {
                                  if (relation) {
                                    onNodeClick(rowNode);
                                  }
                                }}
                              />
                            </TooltipTrigger>
                            {relation && (
                              <TooltipContent side="top" className="text-xs">
                                <span className="font-medium">{rowNode.label}</span>
                                <span className="text-muted-foreground mx-1">\u2194</span>
                                <span className="font-medium">{colNode.label}</span>
                                <span className="text-muted-foreground ml-1">({relation.label})</span>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        );
                      })}
                    </>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </TooltipProvider>
  );
}
