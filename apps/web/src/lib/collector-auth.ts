// SPDX-License-Identifier: FSL-1.1-ALv2
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

// Effective-role resolver. The JWT `role` is client-settable via next-auth
// update() (auth.config.ts copies it verbatim on an update trigger), so a viewer
// could forge role:"owner" client-side — mutations must therefore be gated on the
// DB-verified membership role, never the JWT. The cloud overlay registers a
// resolver that looks up the role for the active org; the open edition falls back
// to a direct Postgres lookup (below), so neither edition trusts the JWT role.
type RoleResolver = (session: SessionLike) => Promise<string | null> | string | null;
let roleResolver: RoleResolver | null = null;

/** Register the DB-backed effective-role resolver (called by the cloud overlay). */
export function registerRoleResolver(fn: RoleResolver): void {
  roleResolver = fn;
}

// Open-edition default: verify the caller's role against the memberships table
// for their active org, keyed on the session user id + org id. A forged JWT
// role/orgId can't produce a membership row, so this returns the caller's REAL
// role (or null if there is no membership → treated as no access). Mirrors
// requireAdminOrg in auth-actions.ts.
async function defaultRoleFromDB(session: SessionLike): Promise<string | null> {
  const userId = session?.user?.id;
  const orgId = session?.user?.orgId;
  if (!userId || !orgId) return null;
  try {
    const { pool } = await import("@/lib/db");
    const { rows } = await pool.query(
      "SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2",
      [userId, orgId]
    );
    return (rows[0]?.role as string | undefined) ?? null;
  } catch {
    return null; // DB unavailable → fail closed (caller denies the mutation)
  }
}

/** The DB-verified role for the session's active org (cloud resolver if
 *  registered, else a direct Postgres lookup). Never derived from the JWT. */
export async function resolveEffectiveRole(session: unknown): Promise<string | null> {
  const s = session as SessionLike;
  if (roleResolver) return (await roleResolver(s)) ?? null;
  return defaultRoleFromDB(s);
}

// Path feature-gate. Plan-gated data (governance/identity/compliance) is served
// by the collector /v1 endpoints, so hiding the nav is not enough — the BFF proxy
// must refuse a path the active org's plan doesn't include (deep-link / direct-API
// bypass). The cloud overlay registers a resolver mapping a /v1 path to its
// required plan feature and checking the org's plan; OSS registers none (allow).
type PathGate = (session: SessionLike, path: string) => Promise<boolean> | boolean;
let pathGate: PathGate | null = null;

/** Register the /v1 path→plan-feature gate (called by the cloud overlay). */
export function registerPathGate(fn: PathGate): void {
  pathGate = fn;
}

/** Whether the session's org may access this /v1 path. True when no gate (OSS). */
export async function resolvePathAllowed(session: unknown, path: string): Promise<boolean> {
  if (!pathGate) return true;
  return (await pathGate(session as SessionLike, path)) !== false;
}

// Membership-change hook. The cloud auth resolver caches membership briefly; when
// a member is removed or their role changes, that cache must be dropped so access
// is revoked immediately. The cloud overlay registers a handler; OSS none.
type MembershipChangeHook = (userId: string, orgId: string) => void;
let membershipChangeHook: MembershipChangeHook | null = null;

/** Register a handler invoked when an org membership is removed/changed. */
export function registerMembershipChangeHook(fn: MembershipChangeHook): void {
  membershipChangeHook = fn;
}

/** Notify that a membership changed (called by team/member server actions). */
export function notifyMembershipChanged(userId: string, orgId: string): void {
  membershipChangeHook?.(userId, orgId);
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
