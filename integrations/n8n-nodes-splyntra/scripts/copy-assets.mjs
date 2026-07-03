// SPDX-License-Identifier: Apache-2.0
// Copy node icons into dist after tsc (tsc only emits .js/.d.ts). Portable
// (no shell cp / gulp) so `npm run build` works on any OS.
import { cpSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const assets = [["nodes/Splyntra/splyntra.svg", "dist/nodes/Splyntra/splyntra.svg"]];
for (const [src, dst] of assets) {
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
  console.log(`copied ${src} -> ${dst}`);
}
