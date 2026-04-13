import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { entityConfig } from "@/components/entity-badge";
import { FolderOpen, MessageSquare, Database, Globe, Cloud, Container, Server, Layers, Box } from "lucide-react";
import type { EntityType, CustomNodeSubType } from "@shared/types";

// When the graph is laid out top-to-bottom (TB) edges come in from the top and
// leave from the bottom. When laid out left-to-right (LR) they come in from the
// left and leave from the right. Matching the handles to the layout direction
// eliminates the "lines everywhere" tangling that happens when handles are
// fixed to Top/Bottom but dagre routes edges horizontally.
function getHandlePositions(data: Record<string, unknown>): { target: Position; source: Position } {
  const dir = data.layoutDir === "LR" ? "LR" : "TB";
  return dir === "LR"
    ? { target: Position.Left, source: Position.Right }
    : { target: Position.Top, source: Position.Bottom };
}

const entityColors: Record<string, string> = {
  project: "#3b82f6",
  mcp: "#22c55e",
  plugin: "#a855f7",
  skill: "#f97316",
  markdown: "#64748b",
  config: "#14b8a6",
  session: "#06b6d4",
  custom: "#f59e0b",
};

const customSubTypeIcons: Record<string, React.ElementType> = {
  database: Database,
  api: Globe,
  service: Server,
  cicd: Layers,
  deploy: Cloud,
  queue: Layers,
  cache: Container,
  other: Box,
};

function ProjectNodeComponent({ data }: { data: Record<string, unknown> }) {
  const nodeType = data.type as EntityType;
  const color = entityColors[nodeType] || "#3b82f6";
  const config = entityConfig[nodeType];
  const Icon = config?.icon || FolderOpen;
  const connectionCount = data.connectionCount as number | undefined;
  const health = data.health as string;
  const isSearchMatch = data.searchMatch as boolean | undefined;
  const { target, source } = getHandlePositions(data);

  return (
    <div
      className="graph-node"
      style={{
        borderTop: `3px solid ${color}`,
        boxShadow: data.isFocus
          ? `0 0 0 2px #a855f7, 0 0 20px #a855f780`
          : isSearchMatch ? `0 0 0 2px ${color}, 0 0 12px ${color}40` : undefined,
      }}
    >
      <Handle type="target" position={target} className="!bg-transparent !border-0 !w-3 !h-3" />
      <div className="flex items-center gap-2.5 px-4 py-3 min-w-[240px]">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-4.5 h-4.5" style={{ color }} />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-foreground truncate">{data.label as string}</span>
            {health === "ok" && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: "#22c55e" }}
              />
            )}
          </div>
          {typeof data.description === "string" && (
            <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">{data.description}</p>
          )}
        </div>
        {(connectionCount ?? 0) > 0 && (
          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 tabular-nums">
            {connectionCount}
          </Badge>
        )}
      </div>
      <Handle type="source" position={source} className="!bg-transparent !border-0 !w-3 !h-3" />
    </div>
  );
}

function EntityNodeComponent({ data }: { data: Record<string, unknown> }) {
  const nodeType = data.type as EntityType;
  const color = entityColors[nodeType] || "#64748b";
  const config = entityConfig[nodeType];
  const Icon = config?.icon || FolderOpen;
  const isSearchMatch = data.searchMatch as boolean | undefined;
  const { target, source } = getHandlePositions(data);

  return (
    <div
      className="graph-node"
      style={{
        borderLeft: `3px solid ${color}`,
        boxShadow: data.isFocus
          ? `0 0 0 2px #a855f7, 0 0 20px #a855f780`
          : isSearchMatch ? `0 0 0 2px ${color}, 0 0 12px ${color}40` : undefined,
      }}
    >
      <Handle type="target" position={target} className="!bg-transparent !border-0 !w-3 !h-3" />
      <div className="flex items-center gap-2 px-3 py-2 min-w-[160px]">
        <div
          className="flex items-center justify-center w-6 h-6 rounded-md shrink-0"
          style={{ backgroundColor: `${color}12` }}
        >
          <Icon className="w-3 h-3" style={{ color }} />
        </div>
        <span className="text-xs text-foreground truncate">{data.label as string}</span>
      </div>
      <Handle type="source" position={source} className="!bg-transparent !border-0 !w-3 !h-3" />
    </div>
  );
}

function SessionNodeComponent({ data }: { data: Record<string, unknown> }) {
  const color = "#06b6d4";
  const isSearchMatch = data.searchMatch as boolean | undefined;
  const { target, source } = getHandlePositions(data);

  return (
    <div
      className="graph-node"
      style={{
        borderLeft: `3px solid ${color}`,
        boxShadow: data.isFocus
          ? `0 0 0 2px #a855f7, 0 0 20px #a855f780`
          : isSearchMatch ? `0 0 0 2px ${color}, 0 0 12px ${color}40` : undefined,
      }}
    >
      <Handle type="target" position={target} className="!bg-transparent !border-0 !w-3 !h-3" />
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 min-w-[120px] max-w-[160px]">
        <MessageSquare className="w-3 h-3 shrink-0" style={{ color }} />
        <span className="text-[11px] text-foreground truncate">{data.label as string}</span>
      </div>
      <Handle type="source" position={source} className="!bg-transparent !border-0 !w-3 !h-3" />
    </div>
  );
}

function CustomNodeComponent({ data }: { data: Record<string, unknown> }) {
  const color = (data.color as string) || "#f59e0b";
  const subType = (data.subType as CustomNodeSubType) || "other";
  const Icon = customSubTypeIcons[subType] || Box;
  const isSearchMatch = data.searchMatch as boolean | undefined;
  const sourceLabel = data.source as string | undefined;
  const { target, source: sourceHandle } = getHandlePositions(data);

  return (
    <div
      className="graph-node"
      style={{
        borderLeft: `3px solid ${color}`,
        boxShadow: data.isFocus
          ? `0 0 0 2px #a855f7, 0 0 20px #a855f780`
          : isSearchMatch ? `0 0 0 2px ${color}, 0 0 12px ${color}40` : undefined,
      }}
    >
      <Handle type="target" position={target} className="!bg-transparent !border-0 !w-3 !h-3" />
      <div className="flex items-center gap-2 px-3 py-2 min-w-[160px]">
        <div
          className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
          style={{ backgroundColor: `${color}18` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-medium text-foreground truncate">{data.label as string}</span>
          {typeof data.description === "string" && (
            <p className="text-[9px] text-muted-foreground truncate max-w-[140px]">{data.description}</p>
          )}
        </div>
        {sourceLabel && (
          <span className="text-[8px] text-muted-foreground/60 shrink-0">{subType}</span>
        )}
      </div>
      <Handle type="source" position={sourceHandle} className="!bg-transparent !border-0 !w-3 !h-3" />
    </div>
  );
}

export const ProjectNode = memo(ProjectNodeComponent);
export const EntityNode = memo(EntityNodeComponent);
export const SessionNode = memo(SessionNodeComponent);
export const CustomGraphNode = memo(CustomNodeComponent);
export { entityColors, customSubTypeIcons };
