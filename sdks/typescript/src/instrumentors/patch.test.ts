// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { pick } from "./patch";

// The instrumentors must find a package's classes whether the host app loaded
// the CommonJS build (module.exports = Class, statics on the object) or the ESM
// build (namespace with a `default` export). `pick` bridges both shapes.
describe("pick — cross CJS/ESM module resolution", () => {
  it("reads a top-level export (CJS module.exports / ESM named)", () => {
    const cjs = { OpenAI: {}, Chat: { Completions: {} } };
    expect(pick(cjs, "Chat")).toBe(cjs.Chat);
  });

  it("falls back to the default export (ESM namespace of a CJS package)", () => {
    const cls = function () {} as unknown as Record<string, unknown>;
    cls.Chat = { Completions: {} };
    const esm = { default: cls, __esModule: true };
    expect(pick(esm, "Chat")).toBe(cls.Chat);
  });

  it("prefers a direct named export over the default export", () => {
    const direct = { via: "named" };
    const esm = { OpenAI: direct, default: { OpenAI: { via: "default" } } };
    expect(pick(esm, "OpenAI")).toBe(direct);
  });

  it("is safe on missing keys and nullish modules", () => {
    expect(pick({}, "Nope")).toBeUndefined();
    expect(pick(undefined, "Nope")).toBeUndefined();
    expect(pick(null, "Nope")).toBeUndefined();
  });
});
