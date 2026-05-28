import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Entity, Relationship, ProjectEntity } from "@shared/types";

export function useProjects() {
  return useQuery<(ProjectEntity & { mcpCount: number; skillCount: number; markdownCount: number })[]>({
    queryKey: ["/api/projects"],
  });
}

export function useProjectDetail(id: string | undefined) {
  return useQuery<{ project: ProjectEntity; relationships: Relationship[]; linkedEntities: Entity[] }>({
    queryKey: [`/api/projects/${id}`],
    enabled: !!id,
  });
}

/** Opens a native terminal in the project's directory (server-side, cross-platform). */
export function useOpenProjectTerminal() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/projects/${id}/open-terminal`);
      return res.json();
    },
  });
}
