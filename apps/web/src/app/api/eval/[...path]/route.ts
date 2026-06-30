// SPDX-License-Identifier: AGPL-3.0-only
// Runtime proxy to the evaluation service (same pattern as the collector
// proxy). Resolves the service URL from the environment per request so one
// image works for self-host and managed cloud.

import { NextRequest, NextResponse } from "next/server";
import { auth as getSession } from "@/auth";
import { roleAtLeast } from "@/lib/db";
import "@/lib/collector-auth-providers"; // side-effect: registers the resolver (no-op in OSS, OAuth/org in cloud)
import { resolveCollectorAuth } from "@/lib/collector-auth";

export const dynamic = "force-dynamic";

function evalBase(): string {
  return (process.env.EVAL_URL || "http://localhost:8002").replace(/\/$/, "");
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const session = await getSession();
    const role = (session?.user as { role?: string })?.role;
    if (!roleAtLeast(role, "member")) {
      return NextResponse.json({ error: "insufficient role" }, { status: 403 });
    }
  }
  const target = `${evalBase()}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  // Authenticate on the logged-in user's behalf (see api/v1 proxy for rationale).
  const session = await getSession();
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
    return NextResponse.json({ error: "evaluation service unreachable", detail: String(err) }, { status: 502 });
  }
}

type Ctx = { params: { path: string[] } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path);
}
