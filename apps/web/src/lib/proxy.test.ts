// SPDX-License-Identifier: FSL-1.1-ALv2
import { describe, it, expect, vi, afterEach } from "vitest";
import { forwardResponse, fetchWithRetry } from "./proxy";

describe("forwardResponse", () => {
  // Regression: a 204 (every successful collector PUT/DELETE) must not be rebuilt
  // with a body, or undici's Response constructor throws "Invalid response status
  // code 204" and the caller mislabels it as a 502.
  it.each([204, 205, 304])("relays null-body status %i without throwing", async (status) => {
    // A real fetch 204 response has a null body; the bug was rebuilding it WITH a
    // body (res.text() → "") which the Response constructor rejects.
    const out = await forwardResponse(new Response(null, { status }));
    expect(out.status).toBe(status);
    expect(await out.text()).toBe("");
  });

  it("relays body and content-type for a normal response", async () => {
    const upstream = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const out = await forwardResponse(upstream);
    expect(out.status).toBe(200);
    expect(out.headers.get("content-type")).toBe("application/json");
    expect(await out.json()).toEqual({ ok: true });
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => vi.restoreAllMocks());

  const socketErr = () => Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });

  it("retries an idempotent method once on a connection error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(socketErr())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWithRetry("http://x/v1/pricing", { method: "PUT" }, "test");
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-idempotent POST (avoids double-submit)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(socketErr());
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithRetry("http://x/runs", { method: "POST" }, "test")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a non-connection error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWithRetry("http://x/v1/pricing", { method: "GET" }, "test")).rejects.toThrow("boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
