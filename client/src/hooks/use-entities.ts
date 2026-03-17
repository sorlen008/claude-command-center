import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Entity, EntityType, ScanStatus, SessionData, SessionStats } from "@shared/types";

export function makeRelativePath(fullPath: string, homeDir: string | null): string {
  if (!homeDir) return fullPath;
  const h = homeDir.replace(/\\/g, "/");
  const p = fullPath.replace(/\\/g, "/");
  return p.startsWith(h + "/") ? "~/" + p.slice(h.length + 1) : p;
}

export function useEntities(type?: EntityType, query?: string) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (query) params.set("q", query);
  const qs = params.toString();
  return useQuery<Entity[]>({
    queryKey: [`/api/entities${qs ? `?${qs}` : ""}`],
  });
}

export function useEntity(id: string | undefined) {
  return useQuery<Entity>({
    queryKey: [`/api/entities/${id}`],
    enabled: !!id,
  });
}

export function useProjects() {
  return useQuery<(Entity & { mcpCount: number; skillCount: number; markdownCount: number })[]>({
    queryKey: ["/api/projects"],
  });
}

export function useProjectDetail(id: string | undefined) {
  return useQuery<{ project: Entity; relationships: any[]; linkedEntities: Entity[] }>({
    queryKey: [`/api/projects/${id}`],
    enabled: !!id,
  });
}

export function useScanStatus() {
  return useQuery<ScanStatus>({
    queryKey: ["/api/scanner/status"],
    staleTime: 5000,
  });
}

export function useRescan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/scanner/rescan");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate data queries (not settings/update)
      qc.invalidateQueries({ queryKey: ["/api/entities"] });
      qc.invalidateQueries({ queryKey: ["/api/scanner/status"] });
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
      qc.invalidateQueries({ queryKey: ["/api/sessions"] });
      qc.invalidateQueries({ queryKey: ["/api/graph"] });
      qc.invalidateQueries({ queryKey: ["/api/apis"] });
      qc.invalidateQueries({ queryKey: ["/api/live"] });
      qc.invalidateQueries({ queryKey: ["/api/stats"] });
      qc.invalidateQueries({ queryKey: ["/api/markdown"] });
    },
  });
}

export function useMarkdownFiles(category?: string) {
  const params = category ? `?category=${category}` : "";
  return useQuery<Entity[]>({
    queryKey: [`/api/markdown${params}`],
  });
}

export function useMarkdownContent(id: string | undefined) {
  return useQuery<Entity & { content: string }>({
    queryKey: [`/api/markdown/${id}`],
    enabled: !!id,
  });
}

export function useMarkdownHistory(id: string | undefined) {
  return useQuery<{ id: number; createdAt: string; reason: string; sizeBytes: number }[]>({
    queryKey: [`/api/markdown/${id}/history`],
    enabled: !!id,
  });
}

export function useSaveMarkdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const res = await apiRequest("PUT", `/api/markdown/${id}`, { content });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/markdown"] });
    },
  });
}

export function useRestoreMarkdown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, backupId }: { id: string; backupId: number }) => {
      const res = await apiRequest("POST", `/api/markdown/${id}/restore/${backupId}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/markdown"] });
    },
  });
}

export function useRuntimeConfig() {
  return useQuery<any>({
    queryKey: ["/api/config/runtime"],
  });
}

export function useConfigSettings() {
  return useQuery<Entity[]>({
    queryKey: ["/api/config/settings"],
  });
}

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
