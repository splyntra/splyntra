// SPDX-License-Identifier: FSL-1.1-ALv2
// Account → Security: change password + delete account (danger zone).
import { SecurityForms } from "./SecurityForms";

export const dynamic = "force-dynamic";

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Security</h1>
        <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-400">
          Manage your password and account.
        </p>
      </div>
      <SecurityForms />
    </div>
  );
}
