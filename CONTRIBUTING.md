# Contributing to Splyntra

Thank you for considering contributing to Splyntra! This guide covers how to build, run, and submit changes.

## Prerequisites

- **Go 1.22+** — collector and API services
- **Python 3.9+** with `uv` — security + evaluation services and Python SDK
- **Node.js 20+** — dashboard and TypeScript SDK
- **Docker + Docker Compose** — local infrastructure
- **Task** (optional) — task runner (`brew install go-task`)

## Getting Started

```bash
# Clone
git clone https://github.com/splyntra/splyntra.git
cd splyntra

# Start infrastructure (Postgres, ClickHouse, NATS, Valkey, MinIO)
docker compose up -d

# Build collector
cd apps/collector && go build -o ../../bin/collector ./cmd/collector

# Install Python SDK (development)
cd sdks/python && uv pip install -e ".[dev]"

# Install dashboard deps
cd apps/web && npm ci

# Run everything
task dev  # or use the Makefile
```

## Project Layout

```
apps/
├── collector/     Go — ingest, auth, redaction, metrics, governance
├── security/      Python — PII, secret, injection detection
├── evaluation/    Python — datasets, scorers, regression gates
└── web/           Next.js dashboard (all pillars + RBAC login)
sdks/
├── python/        Published to PyPI
└── typescript/    Published to npm
schema/proto/      Shared event/span schema (OTel-based)
migrations/        SQL (Postgres + ClickHouse)
```

## Development Workflow

1. **Create a branch** from `main` — use `feat/`, `fix/`, or `docs/` prefixes.
2. **Make your changes** — keep commits focused and atomic.
3. **Run relevant tests** before pushing:
   ```bash
   # Go
   cd apps/collector && go test -race ./...

   # Python SDK
   cd sdks/python && pytest

   # Security service
   cd apps/security && pytest

   # Evaluation service
   cd apps/evaluation && pytest

   # Dashboard
   cd apps/web && npx tsc --noEmit && npm run build
   ```
4. **Open a Pull Request** — fill in the PR template. CI will run automatically.

## Code Style

| Language | Linter / Formatter |
|----------|-------------------|
| Go | `gofmt` + `golangci-lint` |
| Python | `ruff` (format + lint) |
| TypeScript | `eslint` + `prettier` |

## Pull Request Guidelines

- One logical change per PR.
- Include tests for new functionality.
- Update docs if you change user-facing behavior.
- Security-sensitive changes require review from a maintainer.
- All CI checks must pass before merge.

## Running Tests

```bash
task test          # Run all tests
task test:go       # Go only
task test:python   # Python SDK + security + evaluation services
task test:web      # Dashboard type-check + build
```

## Adding a New Detector

1. Create a file in `apps/security/detectors/`.
2. Implement the `scan(text: str) -> list[Detection]` interface.
3. Register it in `apps/security/api/routes.py`.
4. Add tests in `apps/security/tests/`.
5. Document precision expectations in the PR description.

## Versioning & Releasing (automated)

Versioning is automated with **release-please** + **Conventional Commits** — you
never hand-edit a version number. The two SDKs are versioned **in lockstep**
(they always share one version).

### Use Conventional Commits

The bump is derived from commit (and squash-merge) titles:

| Prefix              | Bump  | Example                                  |
|---------------------|-------|------------------------------------------|
| `fix:`              | patch | `fix: redact JWTs in tool output`        |
| `feat:`             | minor | `feat: add CrewAI instrumentor`          |
| `feat!:` / `BREAKING CHANGE:` | major | `feat!: drop Python 3.8 support` |
| `docs:` `chore:` `refactor:` `test:` | none | (no release) |

### The release flow

1. Merge Conventional-Commit PRs to `main`.
2. The [`Release`](.github/workflows/release.yml) workflow's `release-please` job
   opens/updates a single **"Release PR"** that bumps both
   `sdks/python/pyproject.toml` + `src/splyntra/__init__.py` and
   `sdks/typescript/package.json`, and updates each `CHANGELOG.md`.
3. **Merge the Release PR** → release-please creates the GitHub Releases + tags →
   the `publish-pypi` and `publish-npm` jobs run automatically:
   - **PyPI** via Trusted Publishing (OIDC) — no token.
   - **npm** via `npm publish --provenance --access public`.

Config lives in `release-please-config.json` + `.release-please-manifest.json`.

### One-time setup (maintainers)

- **PyPI**: register this repo + `release.yml` as a Trusted Publisher for the
  `splyntra` project, and create a GitHub Environment named `release`.
- **npm**: add an `NPM_TOKEN` repo secret (an npm automation token). The package
  is scoped (`@splyntra/sdk`), so it publishes with `--access public`.

Sanity-check a build locally any time:
```bash
cd sdks/python && python -m build                    # → dist/*.whl, *.tar.gz
cd sdks/typescript && npm run build && npm pack --dry-run
```

## Reporting Issues

- Use GitHub Issues with the appropriate template.
- For security vulnerabilities, see [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
