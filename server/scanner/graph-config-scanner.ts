import fs from "fs";
import path from "path";
import type { CustomNode, CustomEdge, EntityOverride, GraphConfigYaml, CustomNodeSubType } from "@shared/types";
import { HOME, CLAUDE_DIR, fileExists, discoverProjectDirs, normPath } from "./utils";

/** Minimal YAML parser for graph-config.yaml files.
 *  Handles the structured format we expect: nodes/edges/overrides arrays. */
function parseGraphConfigYaml(content: string): GraphConfigYaml | null {
  try {
    const result: GraphConfigYaml = {};
    const lines = content.split("\n");
    let currentSection: "nodes" | "edges" | "overrides" | null = null;
    let currentItem: any = null;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].replace(/\r$/, "");
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = raw.search(/\S/);

      // Top-level keys
      if (indent === 0 && trimmed === "nodes:") {
        currentSection = "nodes";
        result.nodes = [];
        currentItem = null;
        continue;
      }
      if (indent === 0 && trimmed === "edges:") {
        currentSection = "edges";
        result.edges = [];
        currentItem = null;
        continue;
      }
      if (indent === 0 && trimmed === "overrides:") {
        currentSection = "overrides";
        result.overrides = [];
        currentItem = null;
        continue;
      }

      if (!currentSection) continue;

      // Array item start
      if (trimmed.startsWith("- ")) {
        currentItem = {};
        const rest = trimmed.slice(2).trim();
        if (rest.includes(":")) {
          const colonIdx = rest.indexOf(":");
          const key = rest.slice(0, colonIdx).trim();
          const value = rest.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (value) currentItem[key] = value;
        }
        if (currentSection === "nodes") result.nodes!.push(currentItem);
        else if (currentSection === "edges") result.edges!.push(currentItem);
        else if (currentSection === "overrides") result.overrides!.push(currentItem);
        continue;
      }

      // Continuation of current item
      if (currentItem && indent >= 4 && trimmed.includes(":")) {
        const colonIdx = trimmed.indexOf(":");
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (value === "true") currentItem[key] = true;
        else if (value === "false") currentItem[key] = false;
        else if (value) currentItem[key] = value;
      }
    }

    return result;
  } catch {
    return null;
  }
}

const VALID_SUBTYPES = new Set<string>(["service", "database", "api", "cicd", "deploy", "queue", "cache", "other"]);

/** Scan for graph-config.yaml files and extract custom nodes/edges/overrides */
export function scanGraphConfig(): {
  nodes: CustomNode[];
  edges: CustomEdge[];
  overrides: Record<string, EntityOverride>;
} {
  const nodes: CustomNode[] = [];
  const edges: CustomEdge[] = [];
  const overrides: Record<string, EntityOverride> = {};

  // Search locations for graph-config.yaml
  const searchPaths: string[] = [
    normPath(HOME, "graph-config.yaml"),
    normPath(HOME, "graph-config.yml"),
    normPath(CLAUDE_DIR, "graph-config.yaml"),
    normPath(CLAUDE_DIR, "graph-config.yml"),
  ];

  // Also check project directories
  for (const dir of discoverProjectDirs()) {
    searchPaths.push(normPath(dir, "graph-config.yaml"));
    searchPaths.push(normPath(dir, "graph-config.yml"));
  }

  for (const configPath of searchPaths) {
    if (!fileExists(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = parseGraphConfigYaml(content);
      if (!parsed) continue;

      // Process nodes
      if (parsed.nodes) {
        for (const node of parsed.nodes) {
          if (!node.id || !node.label) continue;
          const subType = VALID_SUBTYPES.has(node.type || "") ? (node.type as CustomNodeSubType) : "other";
          nodes.push({
            id: `config-${node.id}`,
            subType,
            label: node.label,
            description: node.description,
            url: node.url,
            icon: node.icon,
            color: node.color,
            source: "config-file",
          });
        }
      }

      // Process edges
      if (parsed.edges) {
        for (const edge of parsed.edges) {
          if (!edge.source || !edge.target || !edge.label) continue;
          edges.push({
            id: `config-edge-${edge.source}-${edge.target}-${edge.label}`,
            source: edge.source,
            target: edge.target,
            label: edge.label,
            color: edge.color,
            dashed: edge.dashed,
            source_origin: "config-file",
          });
        }
      }

      // Process overrides
      if (parsed.overrides) {
        for (const override of parsed.overrides) {
          if (!override.entity) continue;
          const ov: EntityOverride = {};
          if (override.description) ov.description = override.description;
          if (override.color) ov.color = override.color;
          if (override.label) ov.label = override.label;
          overrides[override.entity] = ov;
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  return { nodes, edges, overrides };
}
