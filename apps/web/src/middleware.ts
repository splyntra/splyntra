// SPDX-License-Identifier: AGPL-3.0-only
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge middleware uses the DB-free config to gate routes (the `authorized`
// callback). Full credential verification happens in the Node auth instance.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protect everything except Next internals and public static assets (the logo
  // serves as favicon + PWA icon, fetched directly by the browser, so it must
  // not be auth-gated).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png|manifest.json).*)"],
};
