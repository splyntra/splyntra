// SPDX-License-Identifier: Apache-2.0
// Cross-module-system patching for auto-instrumentation.
//
// Packages like `openai` and `@langchain/langgraph` ship BOTH a CommonJS and an
// ES-module build (selected by the "exports" map). A CJS `require()` and an ESM
// `import` resolve SEPARATE copies of the package with distinct class
// prototypes. An instrumentor that patches only the require() copy is therefore
// a silent no-op in an ESM app (which imports the ESM copy) — the exact bug this
// helper fixes. patchDual applies a patch to both builds:
//
//   • require(): synchronous — covers CJS apps immediately.
//   • import():  the ESM copy. In an ESM app the target module is already loaded
//     by the time Splyntra initializes, so the patch lands on the next microtask
//     — before any network call in a long-lived process (e.g. a server that
//     serves requests after startup). For a script that makes its very first
//     provider call synchronously in the same tick as Splyntra construction,
//     prefer the explicit wrapLLM/wrapAgent wrappers.
//
// The patch callback MUST be idempotent (guard with a `__splyntraWrapped`
// marker on the method it replaces): the same underlying object can be reached
// through more than one specifier or build, and patchDual may invoke it twice.

// `new Function` keeps a genuine dynamic import in the emitted CommonJS. A
// literal `import()` would be down-leveled to `require()` by TypeScript under
// `module: commonjs`, which would reload the CJS build and defeat the purpose.
const esmImport = new Function("spec", "return import(spec)") as (spec: string) => Promise<unknown>;

/**
 * Apply `patch` to every resolvable build (CJS + ESM) of the first matching
 * specifier. Returns true if the synchronous (CJS) patch was applied; the ESM
 * patch, when needed, completes asynchronously. Never throws.
 */
export function patchDual(specifiers: string[], patch: (mod: unknown) => boolean): boolean {
  let applied = false;

  // CommonJS build (synchronous).
  for (const spec of specifiers) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(spec);
      if (patch(mod)) {
        applied = true;
        break;
      }
    } catch {
      /* not resolvable as CJS from here — try the next specifier / the ESM path */
    }
  }

  // ES-module build (asynchronous, best-effort). Idempotent patch → safe even
  // when this reaches the same object the CJS branch already handled.
  for (const spec of specifiers) {
    esmImport(spec)
      .then((mod) => patch(mod))
      .catch(() => {
        /* not resolvable as ESM, or import() unavailable in this runtime */
      });
  }

  return applied;
}

/**
 * Read a property from a module namespace across CJS (`module.exports`) and ESM
 * (`{ default, ...named }`) shapes, without relying on enumerability (class
 * statics are often non-enumerable, so a spread would drop them). Checks the
 * namespace itself first, then its `default` export.
 */
export function pick(mod: unknown, key: string): unknown {
  const m = mod as Record<string, unknown> | undefined;
  const direct = m?.[key];
  if (direct !== undefined) return direct;
  const def = m?.default as Record<string, unknown> | undefined;
  return def?.[key];
}
