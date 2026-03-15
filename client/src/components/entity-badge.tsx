import { Badge } from "@/components/ui/badge";
import type { EntityType } from "@shared/types";
import {
  FolderOpen,
  Server,
  Puzzle,
  Wand2,
  FileText,
  Settings,
} from "lucide-react";

const entityConfig: Record<EntityType, { color: string; bg: string; icon: React.ElementType; label: string }> = {
  project: { color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", icon: FolderOpen, label: "Project" },
  mcp: { color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", icon: Server, label: "MCP" },
  plugin: { color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", icon: Puzzle, label: "Plugin" },
  skill: { color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", icon: Wand2, label: "Skill" },
  markdown: { color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/20", icon: FileText, label: "Markdown" },
  config: { color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20", icon: Settings, label: "Config" },
};

export function EntityBadge({ type }: { type: EntityType }) {
  const config = entityConfig[type];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.bg} ${config.color} gap-1`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

export function EntityIcon({ type, className = "h-4 w-4" }: { type: EntityType; className?: string }) {
  const config = entityConfig[type];
  const Icon = config.icon;
  return <Icon className={`${config.color} ${className}`} />;
}

export { entityConfig };
