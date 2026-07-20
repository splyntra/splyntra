// SPDX-License-Identifier: FSL-1.1-ALv2
// Account → Profile: profile picture, display name + login email. Server
// component reads the current user; forms post to the account server actions.
import { auth } from "@/auth";
import { pool } from "@/lib/db";
import { Avatar } from "@/components/ui/Avatar";
import { ImageUploader } from "@/components/ui/ImageUploader";
import { SettingsCard } from "@/components/ui/primitives";
import { updateAvatarAction } from "@/app/auth-actions";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  const role = (session?.user as { role?: string })?.role;

  let name = "";
  let email = "";
  let avatar: string | null = null;
  if (userId) {
    const { rows } = await pool.query("SELECT name, email, avatar_url FROM users WHERE id = $1", [userId]);
    if (rows[0]) {
      name = rows[0].name || "";
      email = rows[0].email || "";
      avatar = rows[0].avatar_url || null;
    }
  }
  const label = name || email;

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <div className="mb-8 flex items-center gap-4">
        <Avatar name={label} src={avatar} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {name || "Your profile"}
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-gray-500 dark:text-gray-400">
            {email}
            {role ? <span className="uppercase"> · {role}</span> : null}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <SettingsCard title="Profile picture" description="PNG or JPG, resized automatically.">
          <ImageUploader name={label} src={avatar} label="Photo" action={updateAvatarAction} />
        </SettingsCard>

        <ProfileForm name={name} email={email} />
      </div>
    </div>
  );
}
