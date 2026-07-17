// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getActiveProject, setActiveProject } from "@/lib/api";

interface ProjectContextValue {
  /** Active project id, or "" for the API key's default project. */
  projectId: string;
  setProjectId: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  projectId: "",
  setProjectId: () => {},
});

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectId, setProjectIdState] = useState("");
  const queryClient = useQueryClient();

  // Hydrate from localStorage on mount (avoids SSR mismatch).
  useEffect(() => {
    setProjectIdState(getActiveProject());
  }, []);

  const setProjectId = useCallback(
    (id: string) => {
      setActiveProject(id);
      setProjectIdState(id);
      // Switching project changes the scope of every query — refetch all.
      queryClient.invalidateQueries();
    },
    [queryClient]
  );

  return (
    <ProjectContext.Provider value={{ projectId, setProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}
