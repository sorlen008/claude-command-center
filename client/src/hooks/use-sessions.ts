import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  SessionData, SessionStats, SessionSummary, DeepSearchResult,
  CostAnalytics, FileHeatmapResult, HealthAnalytics, StaleAnalytics,
  SessionCostData, CommitLink, ContextLoaderResult,
} from "@shared/types";

export function useSessions(params?: { q?: string; sort?: string; order?: string; hideEmpty?: boolean; activeOnly?: boolean; project?: string }) {
  const p = new URLSearchParams();
  if (params?.q) p.set("q", params.q);
  if (params?.sort) p.set("sort", params.sort);
  if (params?.order) p.set("order", params.order);
  if (params?.hideEmpty) p.set("hideEmpty", "true");
  if (params?.activeOnly) p.set("activeOnly", "true");
  if (params?.project) p.set("project", params.project);
  const qs = p.toString();
  return useQuery<{ sessions: SessionData[]; stats: SessionStats }>({
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
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
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
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
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
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
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
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
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
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
    },
  });
}

export function useSummarizeBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sessions/summarize-batch");
      return res.json() as Promise<{ summarized: string[]; failed: string[]; skipped: string[] }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
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
