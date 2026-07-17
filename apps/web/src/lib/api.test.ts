// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, it, expect, beforeEach } from "vitest";
import { getActiveProject, setActiveProject } from "./api";

describe("active project persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to empty (API key's default project)", () => {
    expect(getActiveProject()).toBe("");
  });

  it("round-trips a selected project id", () => {
    setActiveProject("proj-123");
    expect(getActiveProject()).toBe("proj-123");
  });

  it("clearing resets to default", () => {
    setActiveProject("proj-123");
    setActiveProject("");
    expect(getActiveProject()).toBe("");
  });
});
