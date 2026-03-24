export type EntityType = "project" | "mcp" | "plugin" | "skill" | "markdown" | "config";
export type GraphNodeType = EntityType | "session" | "agent" | "custom";

export type CustomNodeSubType = "service" | "database" | "api" | "cicd" | "deploy" | "queue" | "cache" | "other";

export interface CustomNode {
  id: string;
  subType: CustomNodeSubType;
  label: string;
  description?: string;
  url?: string;
  icon?: string;
  color?: string;
  source: "manual" | "config-file" | "api-config" | "ai-suggested" | "docker-compose" | "auto-discovered";
}

export interface CustomEdge {
  id: string;
  source: string;  // entity ID or custom node ID
  target: string;
  label: string;
  color?: string;
  dashed?: boolean;
  source_origin: "manual" | "config-file" | "api-config" | "ai-suggested" | "docker-compose" | "auto-discovered";
}

// API registry types
export type ApiCategory = "voice" | "communication" | "google" | "infrastructure" | "ai-llm" | "design" | "database";
export type ApiAuthMethod = "api-key" | "oauth2" | "sdk" | "none" | "cdp" | "mcp";
export type ApiStatus = "active" | "configured" | "inactive" | "via-proxy";

export interface ApiDefinition {
  id: string;
  name: string;
  description: string;
  baseUrl?: string;
  authMethod: ApiAuthMethod;
  category: ApiCategory;
  status: ApiStatus;
  envKeys?: string[];
  consumers: string[];
  color?: string;
  website?: string;
  notes?: string;
}

export interface EntityOverride {
  description?: string;
  color?: string;
  label?: string;
}

export interface GraphConfigYaml {
  nodes?: Array<{
    id: string;
    type?: CustomNodeSubType;
    label: string;
    description?: string;
    url?: string;
    icon?: string;
    color?: string;
  }>;
  edges?: Array<{
    source: string;
    target: string;
    label: string;
    color?: string;
    dashed?: boolean;
  }>;
  overrides?: Array<{
    entity: string;  // matches by entity name or ID
    description?: string;
    color?: string;
    label?: string;
  }>;
}

/** Shape of a single MCP server config from .mcp.json */
export interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** Shape of a .mcp.json file (top-level or wrapped) */
export interface MCPConfigFile {
  mcpServers?: Record<string, MCPServerConfig>;
  [key: string]: unknown;
}

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  path: string;
  description: string | null;
  lastModified: string | null;
  tags: string[];
  health: "ok" | "warning" | "error" | "unknown";
  data: Record<string, unknown>;
  scannedAt: string;
}

export interface Relationship {
  id: number;
  sourceId: string;
  sourceType: EntityType;
  targetId: string;
  targetType: EntityType;
  relation: string;
}

export interface MarkdownBackup {
  id: number;
  filePath: string;
  content: string;
  createdAt: string;
  reason: string;
}

export interface ProjectEntity extends Entity {
  type: "project";
  data: {
    projectKey: string;
    sessionCount: number;
    sessionSize: number;
    hasClaudeMd: boolean;
    hasMemory: boolean;
    longDescription?: string;
    techStack?: string[];
    keyFeatures?: string[];
  };
}

export interface MCPEntity extends Entity {
  type: "mcp";
  data: {
    transport: "stdio" | "sse" | "streamable-http";
    command?: string;
    args?: string[];
    url?: string;
    sourceFile: string;
    projectId?: string;
    env?: Record<string, string>;
    category?: string;
    capabilities?: string[];
    website?: string;
  };
}

export interface SkillEntity extends Entity {
  type: "skill";
  data: {
    userInvocable: boolean;
    args: string | null;
    content: string;
  };
}

export interface PluginEntity extends Entity {
  type: "plugin";
  data: {
    marketplace: string | null;
    installed: boolean;
    blocked: boolean;
    blockReason?: string;
    hasMCP: boolean;
    category?: string;
  };
}

export interface MarkdownSection {
  level: number;
  title: string;
  startLine: number;
  endLine: number;
}

export interface MarkdownEntity extends Entity {
  type: "markdown";
  data: {
    category: "claude-md" | "memory" | "skill" | "readme" | "other";
    projectId?: string;
    sizeBytes: number;
    lineCount?: number;
    preview: string;
    frontmatter: Record<string, unknown> | null;
    links?: string[];
    sections?: MarkdownSection[];
    tokenEstimate?: number;
  };
}

export interface MarkdownFileMeta {
  locked?: boolean;
  pinned?: boolean;
}

export interface ContentSearchResult {
  fileId: string;
  fileName: string;
  filePath: string;
  category: string;
  matches: Array<{ line: number; text: string }>;
  matchCount: number;
}

export interface ContextSummary {
  claudeMdFiles: Array<{ name: string; lines: number; tokens: number; sections: number }>;
  memoryFiles: Array<{ name: string; type: string; lines: number; tokens: number }>;
  skillFiles: Array<{ name: string; slash: string }>;
  totalLines: number;
  totalTokens: number;
  memoryMdUsage: { lines: number; limit: number; percentage: number };
}

export interface ConfigEntity extends Entity {
  type: "config";
  data: {
    configType: "settings" | "settings-local" | "mcp";
    content: Record<string, unknown>;
  };
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  description?: string;
  health: "ok" | "warning" | "error" | "unknown";
  position: { x: number; y: number };
  parentId?: string;
  group?: { width: number; height: number };
  subType?: CustomNodeSubType;
  color?: string;
  url?: string;
  source?: string;  // origin of custom node
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  style?: { color: string; strokeWidth: number; dashed?: boolean; dotted?: boolean; animated?: boolean };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ScanStatus {
  scanning: boolean;
  lastScanAt: string | null;
  entityCounts: Record<EntityType, number>;
  totalEntities: number;
  totalRelationships: number;
  sessionCount?: number;
  agentCount?: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  model: string;
  color: string;
  tools: string[];
  source: "plugin" | "user" | "project";
  pluginName?: string;
  marketplace?: string;
  filePath: string;
  content: string;
  writable: boolean;
  lastUsed?: string | null;
}

export interface AgentExecution {
  agentId: string;
  slug: string;
  sessionId: string;
  projectKey: string;
  agentType: string | null;
  model: string | null;
  firstMessage: string;
  firstTs: string | null;
  lastTs: string | null;
  messageCount: number;
  sizeBytes: number;
  filePath: string;
}

export interface AgentStats {
  totalExecutions: number;
  totalDefinitions: number;
  sessionsWithAgents: number;
  byType: Record<string, number>;
  byModel: Record<string, number>;
}

export interface ActiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  activeAgents: ActiveAgent[];
  firstMessage?: string;
  lastMessage?: string;
  slug?: string;
  projectKey?: string;
  contextUsage?: {
    tokensUsed: number;
    maxTokens: number;
    percentage: number;
    model?: string;
  };
  messageCount?: number;
  sizeBytes?: number;
  costEstimate?: number;  // USD
  status?: "thinking" | "waiting" | "idle" | "stale";
  permissionMode?: "default" | "auto-accept" | "bypass";
  gitBranch?: string;
  isPinned?: boolean;
}

export interface ActiveAgent {
  agentId: string;
  slug: string;
  agentType: string | null;
  model: string | null;
  lastWriteTs: string;
  task?: string;  // first user message — what the agent is doing
  status: "running" | "recent";  // running = modified <60s, recent = modified <10min
}

export interface LiveData {
  activeSessions: ActiveSession[];
  recentActivity: AgentExecution[];
  stats: {
    activeSessionCount: number;
    activeAgentCount: number;
    agentsToday: number;
    modelsInUse: string[];
  };
}

export interface RuntimeInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  homeDir: string;
  claudeDir: string;
  uptime: number;
  appVersion?: string;
  memoryUsage?: { rss: number; heapTotal: number; heapUsed: number; external: number };
}

export interface UpdateStatus {
  updateAvailable: boolean;
  currentVersion: string;
  currentCommit: string;
  latestCommit: string | null;
  commitsBehind: number;
  lastCheckedAt: string | null;
  hasGitRemote: boolean;
  updateInProgress: boolean;
  error: string | null;
}

export interface UpdateApplyResult {
  success: boolean;
  steps: { name: string; status: "success" | "failed" | "skipped"; output: string }[];
  restartRequired: boolean;
  error: string | null;
}

export interface UpdatePreferences {
  enabled: boolean;        // master toggle — false = no checking at all
  autoUpdate: boolean;     // auto-apply updates when found
  dismissedCommit: string | null; // commit hash that was dismissed (ignore)
}

export interface SessionData {
  id: string;
  slug: string;
  firstMessage: string;
  firstTs: string | null;
  lastTs: string | null;
  messageCount: number;
  sizeBytes: number;
  tags: string[];
  isEmpty: boolean;
  isActive: boolean;
  filePath: string;
  projectKey: string;
  cwd: string;
  version: string;
  gitBranch: string;
  hasSummary?: boolean;
  summaryTopics?: string[];
  summaryOutcome?: string | null;
  isPinned?: boolean;
  note?: string;
}

export interface SessionSummary {
  sessionId: string;
  summary: string;
  topics: string[];
  toolsUsed: string[];
  outcome: "completed" | "abandoned" | "ongoing" | "error";
  filesModified: string[];
  generatedAt: string;
  model: string;
}

export interface DeepSearchMatch {
  sessionId: string;
  session: SessionData;
  matches: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: string;
    lineIndex: number;
  }>;
  matchCount: number;
  summary?: SessionSummary;
}

export interface DeepSearchResult {
  results: DeepSearchMatch[];
  totalMatches: number;
  totalSessions: number;
  searchedSessions: number;
  durationMs: number;
}

export interface SessionCostData {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCostUsd: number;
  models: string[];
  modelBreakdown: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number; cost: number }>;
}

export interface CostAnalytics {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSessions: number;
  byProject: Record<string, { cost: number; sessions: number; tokens: number }>;
  byDay: Array<{ date: string; cost: number; sessions: number; tokens: number }>;
  byModel: Record<string, { cost: number; tokens: number; sessions: number }>;
  topSessions: Array<{ sessionId: string; firstMessage: string; cost: number; tokens: number }>;
  durationMs: number;
}

export interface FileHeatmapEntry {
  filePath: string;
  fileName: string;
  touchCount: number;
  sessionCount: number;
  operations: { read: number; write: number; edit: number };
  lastTouched: string;
  sessions: string[];
}

export interface FileHeatmapResult {
  files: FileHeatmapEntry[];
  totalFiles: number;
  totalOperations: number;
  durationMs: number;
}

export interface SessionHealth {
  sessionId: string;
  toolErrors: number;
  retries: number;
  totalToolCalls: number;
  healthScore: "good" | "fair" | "poor";
}

export interface HealthAnalytics {
  sessions: SessionHealth[];
  avgToolErrors: number;
  avgRetries: number;
  poorCount: number;
  fairCount: number;
  goodCount: number;
  durationMs: number;
}

export interface CommitLink {
  hash: string;
  message: string;
  timestamp: string;
  filesChanged: number;
}

export interface StaleAnalytics {
  stale: Array<{ id: string; firstMessage: string; lastTs: string; messageCount: number; sizeBytes: number }>;
  empty: Array<{ id: string; sizeBytes: number }>;
  totalStale: number;
  totalEmpty: number;
  reclaimableBytes: number;
}

export interface ContextLoaderResult {
  prompt: string;
  sessionsUsed: number;
  tokensEstimate: number;
}

export interface ProjectDashboard {
  projectKey: string;
  projectPath: string;
  totalSessions: number;
  totalCost: number;
  totalTokens: number;
  totalMessages: number;
  totalSize: number;
  healthBreakdown: { good: number; fair: number; poor: number };
  topFiles: Array<{ fileName: string; touchCount: number }>;
  recentSessions: Array<{ id: string; firstMessage: string; lastTs: string; cost: number; hasSummary: boolean }>;
  commits: number;
  summaryTopics: string[];
}

export interface ProjectDashboardResult {
  projects: ProjectDashboard[];
  durationMs: number;
}

export interface SessionDiff {
  tool: "Write" | "Edit";
  filePath: string;
  timestamp: string;
  oldString?: string;
  newString?: string;
  content?: string;
}

export interface SessionDiffsResult {
  sessionId: string;
  diffs: SessionDiff[];
  totalDiffs: number;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  project?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  isFavorite?: boolean;
}

export interface WeeklyDigest {
  weekStart: string;
  weekEnd: string;
  totalSessions: number;
  totalCost: number;
  totalTokens: number;
  projectBreakdown: Array<{ project: string; sessions: number; cost: number }>;
  topAccomplishments: string[];
  topFiles: Array<{ fileName: string; touchCount: number }>;
  healthSummary: { good: number; fair: number; poor: number };
}

export interface WorkflowConfig {
  autoSummarize: boolean;
  autoArchiveStale: boolean;
  costAlertThreshold: number | null;
  autoTagByPath: boolean;
}

export interface SessionNote {
  sessionId: string;
  text: string;
  updatedAt: string;
}

export interface FileTimelineEntry {
  sessionId: string;
  firstMessage: string;
  lastTs: string;
  tool: "Write" | "Edit";
  timestamp: string;
  oldString?: string;
  newString?: string;
  content?: string;
}

export interface FileTimelineResult {
  filePath: string;
  entries: FileTimelineEntry[];
  totalSessions: number;
}

export interface NLQueryResult {
  answer: string;
  context: string;
  durationMs: number;
}

// --- Continuation Intelligence ---
export interface ContinuationItem {
  sessionId: string;
  firstMessage: string;
  lastTs: string;
  outcome: string;
  summary?: string;
  gitBranch?: string;
  uncommittedFiles?: number;
  lastFiles: string[];
  score: number;
}

export interface ContinuationBrief {
  items: ContinuationItem[];
  generatedAt: string;
}

// --- Decision Log ---
export interface Decision {
  id: string;
  sessionId: string;
  timestamp: string;
  topic: string;
  alternatives: string[];
  chosen: string;
  tradeOffs: string;
  project: string;
  tags: string[];
}

// --- Bash Knowledge Base ---
export interface BashCommand {
  command: string;
  description: string;
  category: string;
  succeeded: boolean;
  errorOutput?: string;
  timestamp: string;
  sessionId: string;
  projectKey: string;
}

export interface BashKnowledgeBase {
  uniqueCommands: number;
  totalExecutions: number;
  byCategory: Record<string, { count: number; successRate: number }>;
  frequentCommands: Array<{ command: string; count: number; successRate: number; lastUsed: string }>;
  failureHotspots: Array<{ command: string; failCount: number; lastError: string }>;
  durationMs: number;
}

export interface BashSearchResult {
  matches: BashCommand[];
  totalMatches: number;
}

// --- Operations Nerve Center ---
export interface ServiceStatus {
  name: string;
  port: number;
  status: "up" | "down" | "unknown";
  responseMs?: number;
}

export interface NerveCenterData {
  services: ServiceStatus[];
  costPacing: { thisWeek: number; avgWeek: number; pacingPct: number };
  uncommittedWork: Array<{ filePath: string; sessionCount: number; editCount: number }>;
  overnightActivity: string[];
  attentionItems: Array<{ severity: "info" | "warning" | "critical"; message: string }>;
  generatedAt: string;
}

// --- Session Delegation ---
export interface DelegationResult {
  target: "terminal" | "telegram" | "voice";
  status: "dispatched" | "failed";
  message: string;
  contextPrompt?: string;
}

export interface SessionStats {
  totalCount: number;
  totalSize: number;
  activeCount: number;
  emptyCount: number;
}

export type BillingMode = "subscription" | "pay-as-you-go" | "auto";

export interface AppSettings {
  appName: string;
  onboarded: boolean;
  billingMode: BillingMode;
  scanPaths: {
    homeDir: string | null;
    claudeDir: string | null;
    extraMcpFiles: string[];
    extraProjectDirs: string[];
    extraSkillDirs: string[];
    extraPluginDirs: string[];
  };
}
