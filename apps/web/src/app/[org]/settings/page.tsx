// SPDX-License-Identifier: FSL-1.1-ALv2
// /settings has no page of its own — send to Profile (the first Account item).
import { redirect } from "next/navigation";

export default function SettingsIndex({ params }: { params: { org: string } }) {
  redirect(`/${params.org}/settings/profile`);
}
