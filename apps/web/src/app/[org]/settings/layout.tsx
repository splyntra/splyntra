// SPDX-License-Identifier: FSL-1.1-ALv2
// Shell for the /settings area: a left rail (Account + Organization groups) plus
// the active settings page. Each page keeps its own centered content wrapper, so
// this layout only provides the rail + a flexible content region.
import type { ReactNode } from "react";
import { SettingsNav } from "./SettingsNav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
