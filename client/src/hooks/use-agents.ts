import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AgentDefinition, AgentExecution, AgentStats, LiveData } from "@shared/types";

export function useAgentDefinitions() {
  return useQuery<AgentDefinition[]>({
    queryKey: ["/api/agents/definitions"],
  });
}

export function useAgentDefinition(id: string | undefined) {
  return useQuery<AgentDefinition>({
    queryKey: [`/api/agents/definitions/${id}`],
    enabled: !!id,
  });
}

export function useSaveAgentDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const res = await apiRequest("PUT", `/api/agents/definitions/${id}`, { content });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agents/definitions"] });
    },
  });
}

export function useCreateAgentDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; description?: string; model?: string; color?: string; tools?: string[]; content?: string }) => {
      const res = await apiRequest("POST", "/api/agents/definitions", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/agents/definitions"] });
    },
  });
}

export function useAgentExecutions(params?: { type?: string; sessionId?: string; q?: string; sort?: string; order?: string; limit?: number }) {
  const p = new URLSearchParams();
  if (params?.type) p.set("type", params.type);
  if (params?.sessionId) p.set("sessionId", params.sessionId);
  if (params?.q) p.set("q", params.q);
  if (params?.sort) p.set("sort", params.sort);
  if (params?.order) p.set("order", params.order);
  if (params?.limit) p.set("limit", String(params.limit));
  const qs = p.toString();
  return useQuery<AgentExecution[]>({
    queryKey: [`/api/agents/executions${qs ? `?${qs}` : ""}`],
  });
}

export function useAgentExecution(agentId: string | undefined) {
  return useQuery<AgentExecution & { records: { type: string; role?: string; timestamp: string; contentPreview: string; model?: string }[] }>({
    queryKey: [`/api/agents/executions/${agentId}`],
    enabled: !!agentId,
  });
}

export function useAgentStats() {
  return useQuery<AgentStats>({
    queryKey: ["/api/agents/stats"],
  });
}

export function useLiveData() {
  return useQuery<LiveData>({
    queryKey: ["/api/live"],
    refetchInterval: 5000,
  });
}
