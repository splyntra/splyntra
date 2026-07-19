// SPDX-License-Identifier: FSL-1.1-ALv2
// Runtime proxy to the collector.
//
// Next.js evaluates next.config.js `rewrites()` at BUILD time, which bakes the
// collector URL into the image and breaks any deployment where the collector is
// reached by a service name (Docker Compose, Helm). This route handler instead
// resolves the collector URL from the environment on every request, so the same
// image works for self-host and managed cloud.

import { NextRequest, NextResponse } from "next/server";
import { auth as getSession } from "@/auth";
import { roleAtLeast } from "@/lib/db";
import "@/lib/collector-auth-providers"; // side-effect: registers the resolver (no-op in OSS, OAuth/org in cloud)
import { resolveCollectorAuth, resolveEffectiveRole, resolvePathAllowed } from "@/lib/collector-auth";

export const dynamic = "force-dynamic";

function collectorBase(): string {
  return (
    process.env.COLLECTOR_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4318"
  ).replace(/\/$/, "");
}

// Mutations require at least 'member'; viewers are read-only. The role MUST come
// from resolveEffectiveRole (DB-verified for the active org), never the JWT
// `role`, which a client can forge via next-auth update(). A null role (no
// membership / DB down) fails closed → 403.
async function forbidViewerMutation(req: NextRequest, session: unknown): Promise<NextResponse | null> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const role = await resolveEffectiveRole(session);
  if (!roleAtLeast(role ?? undefined, "member")) {
    return NextResponse.json({ error: "insufficient role" }, { status: 403 });
  }
  return null;
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  // Reject path traversal before anything else: a `.`/`..` segment would let the
  // fetched URL normalize out of the /v1/ namespace (escaping the plan gate and
  // reaching unintended collector paths). The catch-all already URL-decodes
  // segments, so an encoded %2e%2e arrives here as "..".
  if (path.some((seg) => seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\"))) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const session = await getSession();
  const denied = await forbidViewerMutation(req, session);
  if (denied) return denied;

  // Plan gate: refuse data the active org's plan doesn't include (governance /
  // identity / compliance), so deep-links and direct API calls can't bypass the
  // nav/screen gating. No-op in OSS (no gate registered).
  if (!(await resolvePathAllowed(session, path.join("/")))) {
    return NextResponse.json({ error: "plan upgrade required" }, { status: 403 });
  }
  const target = `${collectorBase()}/v1/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  // Authenticate to the collector on the logged-in user's behalf. The auth seam
  // attaches the right credentials per edition: the server org key (Community)
  // or a service token + active-org headers (Cloud, so data is scoped to the
  // user's org). A logged-in user never pastes an API key to see their data.
  const incoming = (req.headers.get("authorization") || "").replace(/^Bearer\s*/i, "").trim();
  const auth = await resolveCollectorAuth(session, incoming);
  for (const [k, v] of Object.entries(auth.headers)) {
    headers.set(k, v);
  }
  headers.set("content-type", req.headers.get("content-type") || "application/json");

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const res = await fetch(target, init);
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    // Log the detail server-side; don't leak internal host/port/error codes
    // (e.g. "connect ECONNREFUSED 10.x.x.x:4318") to the client.
    console.error("[collector-proxy] fetch failed:", err);
    return NextResponse.json({ error: "collector unreachable" }, { status: 502 });
  }
}

type Ctx = { params: { path: string[] } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
