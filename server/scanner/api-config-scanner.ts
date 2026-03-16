import fs from "fs";
import path from "path";
import type { CustomNode, CustomEdge, ApiDefinition } from "@shared/types";
import { HOME, CLAUDE_DIR, fileExists } from "./utils";

/** Parse apis-config.yaml — handles string arrays (envKeys, consumers) */
function parseApisConfigYaml(content: string): ApiDefinition[] {
  const apis: ApiDefinition[] = [];
  const lines = content.split("\n");
  let inApis = false;
  let current: any = null;
  let currentArrayKey: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = raw.search(/\S/);

    // Top-level "apis:" key
    if (indent === 0 && trimmed === "apis:") {
      inApis = true;
      continue;
    }
    if (indent === 0 && trimmed !== "apis:") {
      inApis = false;
      continue;
    }

    if (!inApis) continue;

    // Array value (  - value) — must check BEFORE new-item detection
    if (indent >= 6 && trimmed.startsWith("- ") && currentArrayKey && current) {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, "");
      if (!current[currentArrayKey]) current[currentArrayKey] = [];
      current[currentArrayKey].push(val);
      continue;
    }

    // New array item (- id: ...) at indent 2
    if (indent <= 2 && trimmed.startsWith("- ")) {
      if (current && current.id) {
        apis.push(current as ApiDefinition);
      }
      current = { consumers: [] };
      currentArrayKey = null;
      const rest = trimmed.slice(2).trim();
      if (rest.includes(":")) {
        const colonIdx = rest.indexOf(":");
        const key = rest.slice(0, colonIdx).trim();
        const value = rest.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (value) current[key] = value;
      }
      continue;
    }

    if (!current) continue;

    // Key-value pair at indent >= 4
    if (indent >= 4 && trimmed.includes(":")) {
      currentArrayKey = null;
      const colonIdx = trimmed.indexOf(":");
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");

      if (!value) {
        // Might be start of an array (envKeys:, consumers:)
        currentArrayKey = key;
        if (!current[key]) current[key] = [];
      } else {
        current[key] = value;
      }
    }
  }

  // Push last item
  if (current && current.id) {
    apis.push(current as ApiDefinition);
  }

  return apis;
}

/** Scan for apis-config.yaml and return API definitions + graph nodes/edges */
export function scanApiConfig(): {
  apis: ApiDefinition[];
  nodes: CustomNode[];
  edges: CustomEdge[];
} {
  const apis: ApiDefinition[] = [];
  const nodes: CustomNode[] = [];
  const edges: CustomEdge[] = [];

  const searchPaths = [
    path.join(HOME, "apis-config.yaml").replace(/\\/g, "/"),
    path.join(HOME, "apis-config.yml").replace(/\\/g, "/"),
    path.join(CLAUDE_DIR, "apis-config.yaml").replace(/\\/g, "/"),
    path.join(CLAUDE_DIR, "apis-config.yml").replace(/\\/g, "/"),
  ];

  const seenIds = new Set<string>();

  for (const configPath of searchPaths) {
    if (!fileExists(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = parseApisConfigYaml(content);

      for (const api of parsed) {
        if (!api.id || !api.name || seenIds.has(api.id)) continue;
        seenIds.add(api.id);
        apis.push(api);

        // Create graph node
        nodes.push({
          id: `config-${api.id}`,
          subType: "api",
          label: api.name,
          description: api.description,
          url: api.website,
          color: api.color,
          source: "api-config",
        });

        // Create edges to consumers
        for (const consumer of api.consumers || []) {
          edges.push({
            id: `api-edge-${api.id}-${consumer}`,
            source: `config-${api.id}`,
            target: consumer,
            label: "uses_api",
            source_origin: "api-config",
          });
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  return { apis, nodes, edges };
}
