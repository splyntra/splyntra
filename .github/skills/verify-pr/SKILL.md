---
name: verify-pr
description: "Run the full pre-PR verification loop: lint, typecheck, test, and license check across all languages. Use before submitting a pull request or to diagnose CI failures locally."
---

# Verify PR

## When to Use

- Before submitting a pull request
- After CI fails and you need to reproduce locally
- After making cross-cutting changes that touch multiple services

## Full Verification Loop

Run all checks in order (fast to slow):

```bash
# 1. Lint (fastest feedback)
task lint

# 2. Type checks
cd apps/web && npx tsc --noEmit && cd ../..
cd sdks/typescript && npx tsc --noEmit && cd ../..

# 3. Tests
task test

# 4. License headers (if new files added)
python scripts/license_headers.py --check
```

## Per-Service Verification

### Go Collector
```bash
cd apps/collector
go vet ./...
go test -race ./...
```

### Python SDK
```bash
cd sdks/python
ruff check . && ruff format --check .
pytest
```

### Python Security Service
```bash
cd apps/security
ruff check . && ruff format --check .
pytest
```

### Python Evaluation Service
```bash
cd apps/evaluation
ruff check . && ruff format --check .
pytest
```

### TypeScript SDK
```bash
cd sdks/typescript
npx tsc --noEmit
npx vitest run
```

### Dashboard
```bash
cd apps/web
npx tsc --noEmit
npm test
```

## License Header Check

Every new file needs an SPDX header:
- Server/Dashboard: `// SPDX-License-Identifier: FSL-1.1-ALv2`
- SDKs: `// SPDX-License-Identifier: Apache-2.0`
- Python: `# SPDX-License-Identifier: FSL-1.1-ALv2` (or Apache-2.0 for SDKs)
- SQL: `-- SPDX-License-Identifier: FSL-1.1-ALv2`

## Commit Message Format

Conventional Commits (drives release-please):
```
feat(collector): add /v1/agents endpoint
fix(sdk): handle empty span attributes
docs: update API reference for cost endpoint
chore(ci): bump Node to 24
```

## PR Checklist

- [ ] Tests pass locally (`task test`)
- [ ] Lint clean (`task lint`)
- [ ] TypeScript compiles (`npx tsc --noEmit` in relevant dirs)
- [ ] SPDX license headers on new files
- [ ] No secrets or credentials in diff
- [ ] Conventional commit message
- [ ] Seam files unchanged (or explicitly flagged as breaking)
