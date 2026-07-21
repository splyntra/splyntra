// SPDX-License-Identifier: FSL-1.1-ALv2
// Account → Security: set/change password, connected sign-ins, delete account.
// Adapts to the user's auth method (password / social / SAML / hybrid).
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { registeredAccountAuthInfo, type LinkedIdentity } from "@/lib/auth-extensions";
import { SecurityForms } from "./SecurityForms";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;

  let hasPassword = false;
  let providers: LinkedIdentity[] = [];
  if (userId) {
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    hasPassword = !!(rows[0]?.password_hash as string | undefined); // '' (social/SAML) → false
    const info = registeredAccountAuthInfo();
    if (info) {
      try {
        ({ providers } = await info(userId));
      } catch {
        providers = [];
      }
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Security</h1>
        <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
          Manage your password, connected sign-ins, and account.
        </p>
      </div>
      <SecurityForms hasPassword={hasPassword} providers={providers} />
    </div>
  );
}
