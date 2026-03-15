import { memo, useState } from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  EdgeLabelRenderer,
  type EdgeProps,
} from "@xyflow/react";

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  label,
  markerEnd,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const strokeColor = (style?.stroke as string) || "#94a3b8";
  const baseWidth = (style?.strokeWidth as number) || 1.5;

  return (
    <>
      {/* Invisible wider path for hover hit area */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: hovered ? baseWidth + 1 : baseWidth,
          strokeDasharray: style?.strokeDasharray || "8 4",
          strokeDashoffset: 0,
          filter: hovered ? `drop-shadow(0 0 4px ${strokeColor})` : undefined,
          transition: "stroke-width 0.2s ease, filter 0.2s ease",
        }}
        className="edge-animated"
      />
      {/* Label shown on hover */}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.2s ease",
          }}
        >
          <div
            className="glass rounded px-2 py-0.5 text-[10px] font-medium border border-border/50 shadow-sm"
            style={{ color: strokeColor }}
          >
            {typeof label === "string" ? label.replace(/_/g, " ") : label}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeComponent);
