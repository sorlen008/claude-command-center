import { useQuery } from "@tanstack/react-query";
import type { ApiDefinition } from "@shared/types";

export function useApis() {
  return useQuery<ApiDefinition[]>({
    queryKey: ["/api/apis"],
  });
}

export interface ApiStats {
  total: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  byAuth: Record<string, number>;
}

export function useApiStats() {
  return useQuery<ApiStats>({
    queryKey: ["/api/apis/stats"],
  });
}
