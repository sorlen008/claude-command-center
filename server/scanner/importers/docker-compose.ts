import fs from "fs";
import path from "path";
import type { CustomNode, CustomEdge } from "@shared/types";
import { discoverProjectDirs, fileExists, HOME, normPath } from "../utils";

interface DockerService {
  image?: string;
  build?: string | { context?: string; dockerfile?: string };
  ports?: string[];
  depends_on?: string[] | Record<string, unknown>;
  networks?: string[] | Record<string, unknown>;
  environment?: string[] | Record<string, string>;
  env_file?: string | string[];
  volumes?: string[];
  command?: string | string[];
  container_name?: string;
}

interface DockerComposeFile {
  services?: Record<string, DockerService>;
  networks?: Record<string, unknown>;
  volumes?: Record<string, unknown>;
}

/** Minimal YAML parser for docker-compose files.
 *  Handles the subset of YAML that docker-compose typically uses.
 *  Falls back gracefully — better than adding a full YAML dep. */
function parseSimpleYaml(content: string): DockerComposeFile | null {
  try {
    const result: any = {};
    const lines = content.split("\n");
    const stack: { indent: number; obj: any; key: string }[] = [{ indent: -1, obj: result, key: "" }];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed.trim() || trimmed.trim().startsWith("#")) continue;

      const indent = trimmed.search(/\S/);
      const content = trimmed.trim();

      // Pop stack to find parent
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;

      if (content.startsWith("- ")) {
        // Array item
        const val = content.slice(2).trim().replace(/^["']|["']$/g, "");
        const parentKey = stack[stack.length - 1].key;
        if (parentKey && parent[parentKey] === undefined) {
          parent[parentKey] = [];
        }
        if (Array.isArray(parent[parentKey])) {
          parent[parentKey].push(val);
        } else if (Array.isArray(parent)) {
          parent.push(val);
        }
      } else if (content.includes(":")) {
        const colonIdx = content.indexOf(":");
        const key = content.slice(0, colonIdx).trim();
        const value = content.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");

        if (value === "" || value === "|" || value === ">") {
          // Nested object or block scalar
          parent[key] = {};
          stack.push({ indent, obj: parent, key });
        } else {
          parent[key] = value;
        }
      }
    }

    return result as DockerComposeFile;
  } catch {
    return null;
  }
}

/** Infer node subtype from docker service */
function inferSubType(name: string, service: DockerService): "database" | "cache" | "queue" | "service" {
  const image = (service.image || "").toLowerCase();
  const nameLower = name.toLowerCase();

  // Databases
  if (image.includes("postgres") || image.includes("mysql") || image.includes("mariadb") ||
      image.includes("mongo") || image.includes("cockroach") || image.includes("sqlite") ||
      nameLower.includes("db") || nameLower.includes("database")) {
    return "database";
  }

  // Caches
  if (image.includes("redis") || image.includes("memcached") || image.includes("dragonfly") ||
      nameLower.includes("cache") || nameLower.includes("redis")) {
    return "cache";
  }

  // Message queues
  if (image.includes("rabbitmq") || image.includes("kafka") || image.includes("nats") ||
      image.includes("pulsar") || nameLower.includes("queue") || nameLower.includes("broker")) {
    return "queue";
  }

  return "service";
}

/** Extract port mappings from docker-compose ports array */
function extractPorts(ports?: string[]): string[] {
  if (!ports) return [];
  return ports.map((p) => {
    if (typeof p === "string") {
      // "8080:80" → "8080"
      const parts = p.split(":");
      return parts[0];
    }
    return String(p);
  });
}

/** Scan all project directories for docker-compose files and extract services */
export function scanDockerCompose(): { nodes: CustomNode[]; edges: CustomEdge[] } {
  const nodes: CustomNode[] = [];
  const edges: CustomEdge[] = [];
  const composeFiles: string[] = [];

  // Check home dir and all project dirs
  const searchDirs = [HOME, ...discoverProjectDirs()];

  for (const dir of searchDirs) {
    for (const filename of ["docker-compose.yml", "docker-compose.yaml", "docker-compose.test.yml", "compose.yml", "compose.yaml"]) {
      const filePath = normPath(dir, filename);
      if (fileExists(filePath) && !composeFiles.includes(filePath)) {
        composeFiles.push(filePath);
      }
    }
  }

  for (const composeFile of composeFiles) {
    try {
      const content = fs.readFileSync(composeFile, "utf-8");
      const parsed = parseSimpleYaml(content);
      if (!parsed?.services) continue;

      const dirName = path.basename(path.dirname(composeFile));
      const services = parsed.services;

      for (const [serviceName, service] of Object.entries(services)) {
        if (typeof service !== "object" || !service) continue;

        const subType = inferSubType(serviceName, service);
        const ports = extractPorts(service.ports as string[] | undefined);
        const nodeId = `docker-${dirName}-${serviceName}`;

        const description = [
          service.image ? `Image: ${service.image}` : service.build ? "Custom build" : "",
          ports.length > 0 ? `Ports: ${ports.join(", ")}` : "",
        ].filter(Boolean).join(" | ");

        nodes.push({
          id: nodeId,
          subType,
          label: `${serviceName}`,
          description: description || `Docker service from ${dirName}`,
          color: subType === "database" ? "#f59e0b" : subType === "cache" ? "#ef4444" : subType === "queue" ? "#8b5cf6" : "#06b6d4",
          source: "docker-compose",
        });

        // depends_on edges
        const dependsOn = service.depends_on;
        if (dependsOn) {
          const deps = Array.isArray(dependsOn) ? dependsOn : Object.keys(dependsOn);
          for (const dep of deps) {
            if (typeof dep === "string") {
              edges.push({
                id: `docker-edge-${nodeId}-${dep}`,
                source: nodeId,
                target: `docker-${dirName}-${dep}`,
                label: "depends_on",
                source_origin: "docker-compose",
              });
            }
          }
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  return { nodes, edges };
}
