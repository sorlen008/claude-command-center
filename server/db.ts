import fs from "fs";
import path from "path";
import os from "os";
import type { Entity, Relationship, MarkdownBackup, AppSettings, CustomNode, CustomEdge, EntityOverride, SessionSummary } from "@shared/types";

const dataDir = process.env.COMMAND_CENTER_DATA
  ? path.resolve(process.env.COMMAND_CENTER_DATA)
  : path.join(os.homedir(), ".claude-command-center");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "command-center.json");
const dbTmpPath = dbPath + ".tmp";

export interface DBData {
  entities: Record<string, Entity>;
  relationships: Relationship[];
  markdownBackups: MarkdownBackup[];
  discoveryCache: Record<string, { results: string; cachedAt: string }>;
  nextRelId: number;
  nextBackupId: number;
  appSettings: AppSettings;
  customNodes: CustomNode[];
  customEdges: CustomEdge[];
  entityOverrides: Record<string, EntityOverride>;
  sessionSummaries: Record<string, SessionSummary>;
}

export const defaultAppSettings: AppSettings = {
  appName: "Command Center",
  onboarded: false,
  scanPaths: {
    homeDir: null,
    claudeDir: null,
    extraMcpFiles: [],
    extraProjectDirs: [],
    extraSkillDirs: [],
    extraPluginDirs: [],
  },
};

function defaultData(): DBData {
  return {
    entities: {},
    relationships: [],
    markdownBackups: [],
    discoveryCache: {},
    nextRelId: 1,
    nextBackupId: 1,
    appSettings: { ...defaultAppSettings, scanPaths: { ...defaultAppSettings.scanPaths } },
    customNodes: [],
    customEdges: [],
    entityOverrides: {},
    sessionSummaries: {},
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
    if (!data.appSettings) data.appSettings = defaultData().appSettings;
    if (!data.customNodes) data.customNodes = [];
    if (!data.customEdges) data.customEdges = [];
    if (!data.entityOverrides) data.entityOverrides = {};
    if (!data.sessionSummaries) data.sessionSummaries = {};
    if (data.appSettings.onboarded === undefined) data.appSettings.onboarded = false;
  } else {
    data = defaultData();
  }
} catch (err) {
  console.error("[db] Failed to load database:", (err as Error).message);
  // If the file exists but can't be parsed, create a backup instead of overwriting
  if (fs.existsSync(dbPath)) {
    const backupPath = dbPath + ".corrupt." + Date.now();
    try {
      fs.copyFileSync(dbPath, backupPath);
      console.warn(`[db] Corrupted DB backed up to: ${backupPath}`);
    } catch {}
  }
  data = defaultData();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Atomic write: write to .tmp then rename */
function writeAtomic(content: string): void {
  fs.writeFileSync(dbTmpPath, content, "utf-8");
  fs.renameSync(dbTmpPath, dbPath);
}

export function save(): void {
  // Debounced save
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      writeAtomic(JSON.stringify(data));
    } catch (err) {
      console.error("[db] Failed to save:", err);
    }
  }, 500);
}

export function saveSync(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    writeAtomic(JSON.stringify(data));
  } catch (err) {
    console.error("[db] Failed to save:", err);
  }
}

export function getDB(): DBData {
  return data;
}

// Flush pending writes on process exit
function onExit() {
  saveSync();
}
process.on("SIGTERM", onExit);
process.on("SIGINT", onExit);
process.on("beforeExit", onExit);
