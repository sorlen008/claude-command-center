import fs from "fs";
import path from "path";
import os from "os";
import type { Entity, Relationship, MarkdownBackup } from "@shared/types";

const dataDir = process.env.COMMAND_CENTER_DATA
  ? path.resolve(process.env.COMMAND_CENTER_DATA)
  : path.join(os.homedir(), ".claude-command-center");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "command-center.json");

export interface DBData {
  entities: Record<string, Entity>;
  relationships: Relationship[];
  markdownBackups: MarkdownBackup[];
  discoveryCache: Record<string, { results: string; cachedAt: string }>;
  nextRelId: number;
  nextBackupId: number;
}

function defaultData(): DBData {
  return {
    entities: {},
    relationships: [],
    markdownBackups: [],
    discoveryCache: {},
    nextRelId: 1,
    nextBackupId: 1,
  };
}

let data: DBData;

try {
  if (fs.existsSync(dbPath)) {
    data = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    // Ensure all fields exist
    if (!data.entities) data.entities = {};
    if (!data.relationships) data.relationships = [];
    if (!data.markdownBackups) data.markdownBackups = [];
    if (!data.discoveryCache) data.discoveryCache = {};
    if (!data.nextRelId) data.nextRelId = 1;
    if (!data.nextBackupId) data.nextBackupId = 1;
  } else {
    data = defaultData();
  }
} catch {
  data = defaultData();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function save(): void {
  // Debounced save
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[db] Failed to save:", err);
    }
  }, 500);
}

export function saveSync(): void {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[db] Failed to save:", err);
  }
}

export function getDB(): DBData {
  return data;
}
