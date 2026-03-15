import { useQuery } from "@tanstack/react-query";
import type { GraphData } from "@shared/types";

export function useGraphData(types?: string[], centerId?: string) {
  const params = new URLSearchParams();
  if (types?.length) params.set("types", types.join(","));
  if (centerId) params.set("center", centerId);
  const qs = params.toString();

  return useQuery<GraphData>({
    queryKey: [`/api/graph${qs ? `?${qs}` : ""}`],
  });
}
