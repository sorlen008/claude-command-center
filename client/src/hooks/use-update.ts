import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { UpdateStatus, UpdateApplyResult } from "@shared/types";

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function useUpdateStatus() {
  return useQuery<UpdateStatus>({
    queryKey: ["/api/update/status"],
    staleTime: SIX_HOURS,
    refetchInterval: SIX_HOURS,
  });
}

export function useCheckForUpdate() {
  const qc = useQueryClient();
  return useMutation<UpdateStatus>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/update/check");
      return res.json();
    },
    onSuccess: (data) => {
      qc.setQueryData(["/api/update/status"], data);
    },
  });
}

export function useApplyUpdate() {
  const qc = useQueryClient();
  return useMutation<UpdateApplyResult>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/update/apply");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/update/status"] });
    },
  });
}
