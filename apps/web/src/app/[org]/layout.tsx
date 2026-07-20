// SPDX-License-Identifier: FSL-1.1-ALv2
// Tenant layout for /{org-slug}/…. Resolves the URL slug → org, verifies the
// signed-in user is a member (bounces otherwise, so a guessed/stale slug can't
// read another org's data), and mounts <OrgSync> to align the JWT's active org
// with the URL (the data plane reads the session orgId, so the URL must sync it).
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { OrgSync } from "./OrgSync";

export const dynamic = "force-dynamic";

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { org: string };
}) {
  const slug = params.org;
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) redirect("/login"); // middleware also gates; defensive

  const { rows } = await pool.query(
    `SELECT o.id::text AS org_id, m.role
     FROM organizations o
     JOIN memberships m ON m.org_id = o.id
     WHERE o.slug = $1 AND m.user_id = $2`,
    [slug, userId]
  );
  const row = rows[0];
  if (!row) {
    // Unknown slug, or the user isn't a member → send them to their own org
    // (avoid a redirect loop if their own slug is the bad one).
    const sessSlug = (session?.user as { orgSlug?: string })?.orgSlug;
    redirect(sessSlug && sessSlug !== slug ? `/${sessSlug}` : "/onboarding");
  }

  return (
    <>
      <OrgSync orgId={row.org_id} role={row.role} slug={slug} />
      {children}
    </>
  );
}
