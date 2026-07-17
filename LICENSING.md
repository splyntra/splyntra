# Licensing

Splyntra follows an **open-core** model. The open-core server, detectors, and
dashboard in this repository are **source-available** under the Functional Source
License; the client SDKs are permissively licensed; and the commercial layer lives
in a separate private repository.

| Path | License | Identifier |
|------|---------|------------|
| repository default (everything below not listed otherwise) | **Functional Source License 1.1 (Apache-2.0 future)** | `FSL-1.1-ALv2` |
| `apps/collector/` (Go event collector + extension seam) | FSL-1.1-ALv2 | `FSL-1.1-ALv2` |
| `apps/security/` (PII / secret / injection detectors) | FSL-1.1-ALv2 | `FSL-1.1-ALv2` |
| `apps/evaluation/` (evaluation framework + deterministic scorers) | FSL-1.1-ALv2 | `FSL-1.1-ALv2` |
| `apps/web/` (dashboard — trace + risk viewer) | FSL-1.1-ALv2 | `FSL-1.1-ALv2` |
| `migrations/`, `deploy/`, `schema/`, `examples/`, `tests/` | FSL-1.1-ALv2 | `FSL-1.1-ALv2` |
| **`sdks/python/`** (`splyntra`) | **Apache-2.0** | `Apache-2.0` |
| **`sdks/typescript/`** (`@splyntra/sdk`) | **Apache-2.0** | `Apache-2.0` |
| **`integrations/`** (auto-instrument connectors / plugins) | **Apache-2.0** | `Apache-2.0` |

The root `LICENSE` is the full FSL-1.1-ALv2 text. Each `sdks/*` directory carries
its own full `Apache-2.0` `LICENSE` that overrides the repository default for that
subtree. `apps/web/` bundles a copy of the FSL `LICENSE` so the published
`@splyntra/dashboard` npm package is self-contained. All three published packages
(`splyntra` on PyPI, `@splyntra/sdk` and `@splyntra/dashboard` on npm) ship their
license text in the distributed artifact.

## What the FSL allows (and doesn't)

The Functional Source License is **source-available, not open source** (it is not
OSI-approved). In plain terms:

- ✅ **Free for any internal or production use inside your company** — run it, self-host
  it, modify it, embed it in your own agents and internal tools, at any scale, at no cost.
- ✅ **Free for non-commercial education and research, and for professional services**
  you provide to someone using Splyntra.
- ❌ **No Competing Use.** You may not make Splyntra available to others as a
  commercial product or service that substitutes for Splyntra or offers substantially
  the same functionality — i.e. you cannot resell it or run it as a competing hosted
  offering.
- 🕒 **Becomes Apache-2.0 after two years.** Each released version automatically
  converts to the permissive Apache License 2.0 on the second anniversary of its
  release, so older versions eventually become fully open source.

This is what lets us keep the platform free for the companies that use it while
preventing a third party from reselling it or standing up a competing service.

## Why this split

- **SDKs and integrations are Apache-2.0** because they are embedded into users'
  own agents and toolchains; a restrictive license there would deter adoption.
- **The server, detectors, and dashboard are FSL-1.1-ALv2** — the source is open to
  read, self-host, and modify for your own use, but the Competing-Use restriction
  prevents resale / competing rehosting, and each version relaxes to Apache-2.0 after
  two years.
- **Governance, identity/SSO, the multi-tenant control plane, billing, and
  advanced detectors/scorers are commercial** and live in the private
  `splyntra-cloud` repository (proprietary). They are not in this repo.

## SPDX headers

Every source file carries an SPDX identifier matching the table above:

```
// SPDX-License-Identifier: FSL-1.1-ALv2      (server / dashboard / detectors)
// SPDX-License-Identifier: Apache-2.0          (sdks + integrations only)
```

`FSL-1.1-ALv2` is not on the SPDX license list (the FSL is not OSI-approved), so
some tooling will report the repository license as "Other" / non-standard — that is
expected for a source-available license.

CI (`.github/workflows/license-check.yml`) fails the build if a source file is
missing a header or carries the wrong one for its directory. Run
`python scripts/license_headers.py` to apply headers, or `--check` to verify.
