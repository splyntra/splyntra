// SPDX-License-Identifier: FSL-1.1-ALv2
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar, ProjectSelector } from "./Sidebar";
import * as hooks from "../../lib/hooks";
import * as projectContext from "../../lib/project-context";

vi.mock("next/navigation", () => ({
  usePathname: () => "/org1",
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { email: "user@example.com", name: "Alice", role: "admin" } },
  }),
  signOut: vi.fn(),
}));

vi.mock("../../lib/branding", () => ({
  useBranding: () => ({
    data: {
      org: { name: "Acme Corp", logo: null },
      user: { avatar: null },
    },
  }),
}));

vi.mock("../../lib/org-path", () => ({
  useOrgHref: () => (p: string) => `/org1${p}`,
  useOrgSlug: () => "org1",
}));

const mockSlotWidgets = vi.fn();
vi.mock("../../lib/slots", () => ({
  navSlotItems: () => [],
  slotWidgets: (slot: string) => mockSlotWidgets(slot) || [],
  usePlanFeatures: () => null,
}));

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

  it("renders compact trigger in collapsed mode and opens dropdown", () => {
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
        ],
        total: 1,
      },
      isLoading: false,
    } as any);

    vi.mocked(projectContext.useProject).mockReturnValue({
      projectId: "proj_active_1",
      setProjectId: setProjectIdMock,
    });

    render(<ProjectSelector collapsed={true} />);

    const button = screen.getByRole("button", { name: /Project: Active Project 1/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByText("Select Project")).toBeInTheDocument();
  });
});

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(hooks.useProjects).mockReturnValue({
      data: { projects: [], total: 0 },
      isLoading: false,
    } as any);
    vi.mocked(projectContext.useProject).mockReturnValue({
      projectId: "",
      setProjectId: vi.fn(),
    });
  });

  it("renders expanded by default and can be collapsed and expanded with toggle button", () => {
    render(<Sidebar />);

    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(sidebar).toHaveClass("w-64");
    expect(screen.getByText("Acme Corp")).toBeInTheDocument();
    expect(screen.getByText("Observability")).toBeInTheDocument();

    // Toggle collapse
    const collapseButton = screen.getByRole("button", { name: /Collapse sidebar/i });
    fireEvent.click(collapseButton);

    expect(sidebar).toHaveClass("w-16");
    expect(screen.queryByText("Observability")).not.toBeInTheDocument();

    // Toggle expand
    const expandButton = screen.getByRole("button", { name: /Expand sidebar/i });
    fireEvent.click(expandButton);

    expect(sidebar).toHaveClass("w-64");
    expect(screen.getByText("Observability")).toBeInTheDocument();
  });

  it("toggles collapse with Cmd+B shortcut", () => {
    render(<Sidebar />);
    const sidebar = screen.getByRole("complementary", { name: "Sidebar navigation" });
    expect(sidebar).toHaveClass("w-64");

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(sidebar).toHaveClass("w-16");

    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(sidebar).toHaveClass("w-64");
  });

  it("passes collapsed prop to sidebarTop and sidebarBottom widgets", () => {
    const TopWidget = vi.fn(({ collapsed }: { collapsed?: boolean }) => (
      <div data-testid="top-widget">TopWidget-{collapsed ? "collapsed" : "expanded"}</div>
    ));
    const BottomWidget = vi.fn(({ collapsed }: { collapsed?: boolean }) => (
      <div data-testid="bottom-widget">BottomWidget-{collapsed ? "collapsed" : "expanded"}</div>
    ));

    mockSlotWidgets.mockImplementation((slot: string) => {
      if (slot === "sidebarTop") return [TopWidget];
      if (slot === "sidebarBottom") return [BottomWidget];
      return [];
    });

    render(<Sidebar />);

    expect(screen.getByTestId("top-widget")).toHaveTextContent("TopWidget-expanded");
    expect(screen.getByTestId("bottom-widget")).toHaveTextContent("BottomWidget-expanded");

    // Toggle collapse
    const collapseButton = screen.getByRole("button", { name: /Collapse sidebar/i });
    fireEvent.click(collapseButton);

    expect(screen.getByTestId("top-widget")).toHaveTextContent("TopWidget-collapsed");
    expect(screen.getByTestId("bottom-widget")).toHaveTextContent("BottomWidget-collapsed");
  });
});
