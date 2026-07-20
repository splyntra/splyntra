// SPDX-License-Identifier: FSL-1.1-ALv2
// Root: no dashboard lives here anymore — everything is under /{org-slug}/….
// Send the signed-in user to their active org (or onboarding if they have none).
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function RootIndex() {
  const session = await auth();
  const slug = (session?.user as { orgSlug?: string })?.orgSlug;
  redirect(slug ? `/${slug}` : "/onboarding");
}
