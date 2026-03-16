import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { entityConfig } from "@/components/entity-badge";
import { entityColors } from "@/components/graph/graph-nodes";
import type { GraphNode } from "@shared/types";
import type { ViewProps } from "./types";

const RADIUS = 220;
const CENTER_X = 300;
const CENTER_Y = 300;
const NODE_RADIUS = 28;

function isMatch(node: GraphNode, query: string): boolean {
  if (!query) return false;
  const q = query.toLowerCase();
  return (
    node.label.toLowerCase().includes(q) ||
    (node.description?.toLowerCase().includes(q) ?? false)
  );
}

export default function RadialView({ nodes, edges, onNodeClick, searchQuery }: ViewProps) {
  const projects = useMemo(() => nodes.filter((n) => n.type === "project"), [nodes]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const activeProject = useMemo(() => {
    if (selectedProjectId) return nodes.find((n) => n.id === selectedProjectId) ?? projects[0];
    return projects[0] ?? null;
  }, [selectedProjectId, projects, nodes]);

  const { connected, edgesForProject } = useMemo(() => {
    if (!activeProject) return { connected: [], edgesForProject: [] };
    const relevantEdges = edges.filter(
      (e) => e.source === activeProject.id || e.target === activeProject.id
    );
    const connectedIds = new Set(
      relevantEdges.map((e) =>
        e.source === activeProject.id ? e.target : e.source
      )
    );
    return {
      connected: nodes.filter((n) => connectedIds.has(n.id)),
      edgesForProject: relevantEdges,
    };
  }, [activeProject, nodes, edges]);

  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No projects found.
      </div>
    );
  }

  const svgSize = CENTER_X * 2;

  return (
    <div className="flex flex-col h-full">
      {/* Project selector */}
      {projects.length > 1 && (
        <div className="flex gap-1.5 p-3 border-b border-border overflow-x-auto shrink-0">
          {projects.map((p) => {
            const active = p.id === activeProject.id;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedProjectId(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="flex items-center justify-center p-4 min-h-[500px]">
          <svg
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            className="max-w-full"
          >
            {/* Connection lines */}
            {connected.map((child, i) => {
              const angle = (2 * Math.PI * i) / connected.length - Math.PI / 2;
              const x = CENTER_X + RADIUS * Math.cos(angle);
              const y = CENTER_Y + RADIUS * Math.sin(angle);
              const edge = edgesForProject.find(
                (e) =>
                  (e.source === activeProject.id && e.target === child.id) ||
                  (e.target === activeProject.id && e.source === child.id)
              );
              const lineColor = edge?.style?.color || entityColors[child.type] || "#64748b";

              return (
                <line
                  key={child.id}
                  x1={CENTER_X}
                  y1={CENTER_Y}
                  x2={x}
                  y2={y}
                  stroke={lineColor}
                  strokeWidth={1.5}
                  strokeOpacity={0.4}
                  strokeDasharray={edge?.style?.dashed ? "4 4" : undefined}
                />
              );
            })}

            {/* Center project node */}
            <g
              onClick={() => onNodeClick(activeProject)}
              className="cursor-pointer"
            >
              <circle
                cx={CENTER_X}
                cy={CENTER_Y}
                r={NODE_RADIUS + 8}
                fill={`${entityColors.project}15`}
                stroke={
                  isMatch(activeProject, searchQuery) ? entityColors.project : `${entityColors.project}40`
                }
                strokeWidth={isMatch(activeProject, searchQuery) ? 2.5 : 1.5}
              />
              <text
                x={CENTER_X}
                y={CENTER_Y - 4}
                textAnchor="middle"
                fill={entityColors.project}
                fontSize={11}
                fontWeight={600}
              >
                {activeProject.label.length > 14
                  ? activeProject.label.slice(0, 12) + "\u2026"
                  : activeProject.label}
              </text>
              <text
                x={CENTER_X}
                y={CENTER_Y + 12}
                textAnchor="middle"
                fill="hsl(var(--muted-foreground))"
                fontSize={9}
              >
                project
              </text>
            </g>

            {/* Connected entity nodes */}
            {connected.map((child, i) => {
              const angle = (2 * Math.PI * i) / connected.length - Math.PI / 2;
              const x = CENTER_X + RADIUS * Math.cos(angle);
              const y = CENTER_Y + RADIUS * Math.sin(angle);
              const color = entityColors[child.type] || "#64748b";
              const matched = isMatch(child, searchQuery);
              const edge = edgesForProject.find(
                (e) =>
                  (e.source === activeProject.id && e.target === child.id) ||
                  (e.target === activeProject.id && e.source === child.id)
              );

              return (
                <g
                  key={child.id}
                  onClick={() => onNodeClick(child)}
                  className="cursor-pointer"
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={NODE_RADIUS}
                    fill={`${color}12`}
                    stroke={matched ? color : `${color}40`}
                    strokeWidth={matched ? 2.5 : 1}
                  />
                  <text
                    x={x}
                    y={y - 4}
                    textAnchor="middle"
                    fill="hsl(var(--foreground))"
                    fontSize={10}
                    fontWeight={500}
                  >
                    {child.label.length > 10
                      ? child.label.slice(0, 8) + "\u2026"
                      : child.label}
                  </text>
                  <text
                    x={x}
                    y={y + 10}
                    textAnchor="middle"
                    fill={color}
                    fontSize={8}
                  >
                    {child.type}
                  </text>
                  {/* Edge label */}
                  {edge && (
                    <text
                      x={x + (CENTER_X - x) * 0.25}
                      y={y + (CENTER_Y - y) * 0.25 - 6}
                      textAnchor="middle"
                      fill="hsl(var(--muted-foreground))"
                      fontSize={8}
                      opacity={0.7}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </ScrollArea>
    </div>
  );
}
