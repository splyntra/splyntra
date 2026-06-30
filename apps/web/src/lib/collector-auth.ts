// SPDX-License-Identifier: AGPL-3.0-only
// Resolves how the dashboard BFF authenticates to the collector / evaluation
// service on behalf of the logged-in user. This is the multi-tenant seam.
//
// Open (Community) default: a single implicit org, so the BFF attaches the
// server-side org key (SPLYNTRA_API_KEY) — or, only outside production, the dev
// key. The commercial Cloud build registers a resolver via the overlay module
// `@/lib/collector-auth-providers`, which the BFF routes import for its side
// effects (it registers a resolver that uses a trusted service token +
// X-Splyntra-Org-Id headers so each request is scoped to the user's ACTIVE org;
// api_keys store only hashes, so a per-org key can't be replayed). The collector
// honors that header path only when its COLLECTOR_SERVICE_TOKEN matches.
//
// NOTE: this module must NOT import the providers module — that would create an
// import cycle (providers → this module's registry), so the BFF routes do the
// side-effect import instead.

type SessionLike = { user?: { id?: string; orgId?: string; role?: string } } | null | undefined;
export interface CollectorAuth {
  headers: Record<string, string>;
}
// May be async: the cloud resolver verifies org membership in Postgres before
// trusting session.orgId (so a forged JWT orgId can't reach another tenant).
type Resolver = (
  session: SessionLike,
  incomingKey: string
) => Promise<CollectorAuth | null> | CollectorAuth | null;

let resolver: Resolver | null = null;

/** Register the BFF auth resolver (called by the cloud overlay). */
export function registerCollectorAuthResolver(fn: Resolver): void {
  resolver = fn;
}

// Community default: explicit client key, else the server org key, else the dev
// key in non-production. Never falls back to the dev key in production.
function defaultAuth(incomingKey: string): CollectorAuth {
  // The dev key activates ONLY when NODE_ENV is explicitly "development" — an
  // unset NODE_ENV in production must NOT silently enable it (fail closed).
  const serverKey =
    process.env.SPLYNTRA_API_KEY ||
    (process.env.NODE_ENV === "development" ? "splyntra_dev_key" : "");
  const key = incomingKey || serverKey;
  return { headers: key ? { authorization: `Bearer ${key}` } : {} };
}

/** Resolve the auth headers the BFF must attach for this request. */
export async function resolveCollectorAuth(session: unknown, incomingKey: string): Promise<CollectorAuth> {
  if (resolver) {
    const r = await resolver(session as SessionLike, incomingKey);
    if (r) return r;
  }
  return defaultAuth(incomingKey);
}
