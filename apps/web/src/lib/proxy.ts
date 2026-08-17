// SPDX-License-Identifier: FSL-1.1-ALv2
// Shared plumbing for the runtime service proxies (api/v1 → collector,
// api/eval → evaluation service). Keeping the response forwarding in ONE place
// prevents the two proxies from drifting: the null-body-status handling below is
// the fix for a class of bug where a 204/205/304 upstream response must NOT be
// rebuilt with a body — undici's Response constructor throws "Invalid response
// status code 204" for any body init (even ""), which a proxy would then
// mislabel as a 502. The collector returns 204 for every successful PUT/DELETE.

import { NextResponse } from "next/server";

// Statuses the Fetch spec forbids a body on (RFC 9110 §6.4.1 / §15.3.5).
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

// forwardResponse relays an upstream fetch Response as a NextResponse, preserving
// status and content-type and safely handling null-body statuses.
export async function forwardResponse(res: Response): Promise<NextResponse> {
  if (NULL_BODY_STATUSES.has(res.status)) {
    return new NextResponse(null, { status: res.status });
  }
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" },
  });
}

// fetchWithRetry retries once on a pre-response connection error (a dead
// keep-alive socket the upstream closed on its idle timeout, or a transient
// reset). A thrown fetch means no response was received, so re-issuing is only
// safe for idempotent methods — a non-idempotent POST (e.g. starting an eval
// run) is NOT retried, to avoid double-submission. `init.body` is an
// already-buffered string, so it re-sends fine.
export async function fetchWithRetry(target: string, init: RequestInit, label: string): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD" || method === "PUT" || method === "DELETE";
  try {
    return await fetch(target, init);
  } catch (err) {
    if (!idempotent || !isConnectionError(err)) throw err;
    console.warn(`[${label}] retrying after connection error:`, err);
    return await fetch(target, init);
  }
}

function isConnectionError(err: unknown): boolean {
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ||
    (err as { code?: string })?.code ||
    "";
  const msg = err instanceof Error ? err.message : "";
  return (
    /UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE/.test(code) ||
    /other side closed|socket hang up/i.test(msg)
  );
}
