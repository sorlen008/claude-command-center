import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  SessionData, SessionStats, SessionSummary, DeepSearchResult,
  CostAnalytics, FileHeatmapResult, HealthAnalytics, StaleAnalytics,
  SessionCostData, CommitLink, ContextLoaderResult,
  ProjectDashboardResult, SessionDiffsResult, PromptTemplate, WeeklyDigest, WorkflowConfig,
  SessionNote, FileTimelineResult, NLQueryResult,
  ContinuationBrief, Decision, BashKnowledgeBase, BashSearchResult,
  NerveCenterData, DelegationResult,
} from "@shared/types";

export function useSessions(params?: { q?: string; sort?: string; order?: string; hideEmpty?: boolean; activeOnly?: boolean; project?: string; page?: number; limit?: number }) {
  const p = new URLSearchParams();
  if (params?.q) p.set("q", params.q);
  if (params?.sort) p.set("sort", params.sort);
  if (params?.order) p.set("order", params.order);
  if (params?.hideEmpty) p.set("hideEmpty", "true");
  if (params?.activeOnly) p.set("activeOnly", "true");
  if (params?.project) p.set("project", params.project);
  if (params?.page) p.set("page", String(params.page));
  if (params?.limit) p.set("limit", String(params.limit));
  const qs = p.toString();
  return useQuery<{ sessions: SessionData[]; stats: SessionStats; page?: number; limit?: number; total?: number; totalPages?: number }>({
    queryKey: [`/api/sessions${qs ? `?${qs}` : ""}`],
  });
}

export function useSessionDetail(id: string | undefined) {
  return useQuery<SessionData & { records: { type: string; role?: string; timestamp: string; contentPreview: string }[] }>({
    queryKey: [`/api/sessions/${id}`],
    enabled: !!id,
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/sessions/${id}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") });
    },
  });
}

export function useBulkDeleteSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("DELETE", "/api/sessions", { ids });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") });
    },
  });
}

export function useOpenSession() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sessions/${id}/open`);
      return res.json();
    },
  });
}

export function useDeleteAllSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sessions/delete-all");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") });
    },
  });
}

export function useUndoDeleteSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sessions/undo");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") });
    },
  });
}

export function useDeepSearch(params: { q?: string; field?: string; dateFrom?: string; dateTo?: string; project?: string; limit?: number }) {
  const p = new URLSearchParams();
  if (params.q) p.set("q", params.q);
  if (params.field) p.set("field", params.field);
  if (params.dateFrom) p.set("dateFrom", params.dateFrom);
  if (params.dateTo) p.set("dateTo", params.dateTo);
  if (params.project) p.set("project", params.project);
  if (params.limit) p.set("limit", String(params.limit));
  const qs = p.toString();
  return useQuery<DeepSearchResult>({
    queryKey: [`/api/sessions/search${qs ? `?${qs}` : ""}`],
    enabled: (params.q?.length ?? 0) >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSummarizeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sessions/${id}/summarize`);
      return res.json() as Promise<SessionSummary>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") });
    },
  });
}

export function useSummarizeBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mode: "all" | "top10" | "pinned" = "all") => {
      const res = await apiRequest("POST", "/api/sessions/summarize-batch", { mode });
      return res.json() as Promise<{ summarized: string[]; failed: string[]; skipped: string[] }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") });
    },
  });
}

export function useSessionSummary(id: string | undefined) {
  return useQuery<SessionSummary>({
    queryKey: [`/api/sessions/${id}/summary`],
    enabled: !!id,
    retry: false,
  });
}

// Analytics hooks
export function useCostAnalytics() {
  return useQuery<CostAnalytics>({
    queryKey: ["/api/sessions/analytics/costs"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useFileHeatmap() {
  return useQuery<FileHeatmapResult>({
    queryKey: ["/api/sessions/analytics/files"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useHealthAnalytics() {
  return useQuery<HealthAnalytics>({
    queryKey: ["/api/sessions/analytics/health"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useStaleAnalytics() {
  return useQuery<StaleAnalytics>({
    queryKey: ["/api/sessions/analytics/stale"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useSessionCost(id: string | undefined) {
  return useQuery<SessionCostData>({
    queryKey: [`/api/sessions/${id}/costs`],
    enabled: !!id,
    retry: false,
  });
}

export function useSessionCommits(id: string | undefined) {
  return useQuery<{ sessionId: string; commits: CommitLink[] }>({
    queryKey: [`/api/sessions/${id}/commits`],
    enabled: !!id,
    retry: false,
  });
}

export function useContextLoader() {
  return useMutation({
    mutationFn: async (project: string) => {
      const res = await apiRequest("POST", "/api/sessions/context-loader", { project });
      return res.json() as Promise<ContextLoaderResult>;
    },
  });
}

export function useProjectDashboards() {
  return useQuery<ProjectDashboardResult>({
    queryKey: ["/api/sessions/analytics/projects"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useSessionDiffs(id: string | undefined) {
  return useQuery<SessionDiffsResult>({
    queryKey: [`/api/sessions/${id}/diffs`],
    enabled: !!id,
    retry: false,
  });
}

export function usePromptTemplates() {
  return useQuery<PromptTemplate[]>({
    queryKey: ["/api/sessions/prompts"],
  });
}

export function useCreatePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; description?: string; prompt: string; project?: string; tags?: string[] }) => {
      const res = await apiRequest("POST", "/api/sessions/prompts", data);
      return res.json() as Promise<PromptTemplate>;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sessions/prompts"] }); },
  });
}

export function useDeletePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/sessions/prompts/${id}`);
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sessions/prompts"] }); },
  });
}

export function useWeeklyDigest() {
  return useQuery<WeeklyDigest>({
    queryKey: ["/api/sessions/analytics/digest"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useWorkflowConfig() {
  return useQuery<WorkflowConfig>({
    queryKey: ["/api/sessions/workflows"],
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<WorkflowConfig>) => {
      const res = await apiRequest("PATCH", "/api/sessions/workflows", patch);
      return res.json() as Promise<WorkflowConfig>;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sessions/workflows"] }); },
  });
}

export function useRunWorkflows() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sessions/workflows/run");
      return res.json();
    },
  });
}

export function useTogglePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sessions/pin/${id}`);
      return res.json() as Promise<{ sessionId: string; isPinned: boolean }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") });
    },
  });
}

export function useSessionNote(id: string | undefined) {
  return useQuery<SessionNote>({
    queryKey: [`/api/sessions/${id}/note`],
    enabled: !!id,
    retry: false,
  });
}

export function useSaveNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const res = await apiRequest("PUT", `/api/sessions/${id}/note`, { text });
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/sessions") }); },
  });
}

export function useFileTimeline(filePath: string | undefined) {
  const p = new URLSearchParams();
  if (filePath) p.set("path", filePath);
  return useQuery<FileTimelineResult>({
    queryKey: [`/api/sessions/file-timeline?${p.toString()}`],
    enabled: !!filePath,
    retry: false,
  });
}

export function useNLQuery() {
  return useMutation({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", "/api/sessions/nl-query", { question });
      return res.json() as Promise<NLQueryResult>;
    },
  });
}

export function useContinuations() {
  return useQuery<ContinuationBrief>({
    queryKey: ["/api/sessions/continuations"],
    staleTime: 60 * 1000,
  });
}

export function useDecisions(query?: string) {
  const qs = query ? `?q=${encodeURIComponent(query)}` : "";
  return useQuery<Decision[]>({
    queryKey: [`/api/sessions/decisions${qs}`],
    staleTime: 30 * 1000,
  });
}

export function useExtractDecisions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sessions/decisions/extract/${id}`);
      return res.json() as Promise<{ decisions: Decision[]; count: number }>;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sessions/decisions"] }); },
  });
}

export function useBashKnowledge() {
  return useQuery<BashKnowledgeBase>({
    queryKey: ["/api/sessions/analytics/bash"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useBashSearch(query: string) {
  return useQuery<BashSearchResult>({
    queryKey: [`/api/sessions/analytics/bash/search?q=${encodeURIComponent(query)}`],
    enabled: query.length >= 2,
  });
}

export function useNerveCenter() {
  return useQuery<NerveCenterData>({
    queryKey: ["/api/sessions/nerve-center"],
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function useDelegate() {
  return useMutation({
    mutationFn: async (params: { sessionId: string; target: string; task?: string }) => {
      const res = await apiRequest("POST", "/api/sessions/delegate", params);
      return res.json() as Promise<DelegationResult>;
    },
  });
}
