// SPDX-License-Identifier: FSL-1.1-ALv2
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectSelector } from "./Sidebar";
import * as hooks from "../../lib/hooks";
import * as projectContext from "../../lib/project-context";

vi.mock("../../lib/hooks", () => ({
  useProjects: vi.fn(),
}));

vi.mock("../../lib/project-context", () => ({
  useProject: vi.fn(),
}));

describe("ProjectSelector", () => {
  const setProjectIdMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only active projects and excludes archived projects", () => {
    vi.mocked(hooks.useProjects).mockReturnValue({
      data: {
        projects: [
          {
            id: "proj_active_1",
            name: "Active Project 1",
            slug: "active-project-1",
            environment: "production",
            created_at: new Date().toISOString(),
            archived_at: null,
          },
          {
            id: "proj_archived_2",
            name: "Archived Project 2",
            slug: "archived-project-2",
            environment: "staging",
            created_at: new Date().toISOString(),
            archived_at: new Date().toISOString(),
          },
        ],
        total: 2,
      },
      isLoading: false,
    } as any);

    vi.mocked(projectContext.useProject).mockReturnValue({
      projectId: "proj_active_1",
      setProjectId: setProjectIdMock,
    });

    render(<ProjectSelector />);

    // Active project should be rendered
    expect(screen.getByText(/Active Project 1 \(production\)/)).toBeInTheDocument();
    // Archived project should NOT be rendered in options
    expect(screen.queryByText(/Archived Project 2/)).not.toBeInTheDocument();
  });

  it("resets projectId if the selected project is archived", () => {
    vi.mocked(hooks.useProjects).mockReturnValue({
      data: {
        projects: [
          {
            id: "proj_active_1",
            name: "Active Project 1",
            slug: "active-project-1",
            environment: "production",
            created_at: new Date().toISOString(),
            archived_at: null,
          },
          {
            id: "proj_archived_2",
            name: "Archived Project 2",
            slug: "archived-project-2",
            environment: "staging",
            created_at: new Date().toISOString(),
            archived_at: new Date().toISOString(),
          },
        ],
        total: 2,
      },
      isLoading: false,
    } as any);

    // Selected project is the archived one
    vi.mocked(projectContext.useProject).mockReturnValue({
      projectId: "proj_archived_2",
      setProjectId: setProjectIdMock,
    });

    render(<ProjectSelector />);

    // setProjectId("") should be called to clear the archived project
    expect(setProjectIdMock).toHaveBeenCalledWith("");
  });

  it("renders null when all projects are archived", () => {
    vi.mocked(hooks.useProjects).mockReturnValue({
      data: {
        projects: [
          {
            id: "proj_archived_1",
            name: "Archived Project 1",
            slug: "archived-project-1",
            environment: "production",
            created_at: new Date().toISOString(),
            archived_at: new Date().toISOString(),
          },
        ],
        total: 1,
      },
      isLoading: false,
    } as any);

    vi.mocked(projectContext.useProject).mockReturnValue({
      projectId: "",
      setProjectId: setProjectIdMock,
    });

    const { container } = render(<ProjectSelector />);
    expect(container.firstChild).toBeNull();
  });
});
