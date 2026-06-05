# Licensing

Splyntra follows an **open-core** model. This repository (the open core) is split
across two licenses; the commercial layer lives in a separate private repository.

| Path | License | SPDX |
|------|---------|------|
| repository default (everything below not listed otherwise) | **GNU AGPL-3.0-only** | `AGPL-3.0-only` |
| `apps/collector/` (Go event collector + extension seam) | AGPL-3.0-only | `AGPL-3.0-only` |
| `apps/security/` (PII / secret / injection detectors) | AGPL-3.0-only | `AGPL-3.0-only` |
| `apps/evaluation/` (evaluation framework + deterministic scorers) | AGPL-3.0-only | `AGPL-3.0-only` |
| `apps/web/` (dashboard — trace + risk viewer) | AGPL-3.0-only | `AGPL-3.0-only` |
| `migrations/`, `deploy/`, `schema/`, `examples/`, `tests/` | AGPL-3.0-only | `AGPL-3.0-only` |
| **`sdks/python/`** (`splyntra`) | **Apache-2.0** | `Apache-2.0` |
| **`sdks/typescript/`** (`@splyntra/sdk`) | **Apache-2.0** | `Apache-2.0` |

The root `LICENSE` is the AGPL-3.0 text. Each `sdks/*` directory carries its own
`Apache-2.0` `LICENSE` that overrides the repository default for that subtree.

## Why this split

- **SDKs are Apache-2.0** because they are embedded into users' own agents;
  copyleft there would deter adoption.
- **The server, detectors, and dashboard are AGPL-3.0** — genuinely open and
  OSI-approved, with the network clause deterring closed-source cloud rehosting.
- **Governance, identity/SSO, the multi-tenant control plane, billing, and
  advanced detectors/scorers are commercial** and live in the private
  `splyntra-cloud` repository (proprietary). They are not in this repo.

## SPDX headers

Every source file carries an SPDX identifier matching the table above:

```
// SPDX-License-Identifier: AGPL-3.0-only     (server / dashboard / detectors)
// SPDX-License-Identifier: Apache-2.0          (sdks only)
```

CI (`.github/workflows/license-check.yml`) fails the build if a source file is
missing a header or carries the wrong one for its directory.

> This document describes structure, not legal advice. The AGPL/Apache split, the
> Apache→AGPL relicensing of the server core, and the CLA should be confirmed with
> counsel before publishing release tags.
