---
applyTo: "sdks/**"
description: "SDK conventions: OpenTelemetry-native tracing, redact-by-default, Apache-2.0 license, and dual-language (Python + TypeScript) patterns."
---

# SDK Instructions

## Design Principles

1. **OTel-native**: SDKs emit standard OpenTelemetry spans — no proprietary formats
2. **Redact by default**: Strip sensitive data (secrets, PII) before export
3. **Zero-config start**: Instrument with a single function call / decorator
4. **Framework-agnostic**: Core SDK doesn't depend on specific AI frameworks

## Python SDK (`sdks/python/`)

- Package: `splyntra` (published to PyPI)
- License: Apache-2.0 (SPDX header required)
- Source in `src/splyntra/`
- Entry point: `splyntra.init()` or `@splyntra.trace` decorator
- Uses OpenTelemetry Python SDK under the hood

```bash
cd sdks/python
pip install -e ".[dev]"
pytest
ruff check . && ruff format --check .
```

## TypeScript SDK (`sdks/typescript/`)

- Package: `@splyntra/sdk` (published to npm)
- License: Apache-2.0 (SPDX header required)
- Source in `src/`
- Entry point: `Splyntra.init()` wrapper around OTel Node SDK

```bash
cd sdks/typescript
npm install
npx vitest run
npx tsc --noEmit
```

## Adding Span Attributes

- Use semantic conventions from OpenTelemetry where possible
- Custom attributes use `splyntra.*` namespace (e.g. `splyntra.agent.name`)
- Document new attributes in `schema/proto/splyntra/`

## Gotchas

- Never add FSL-licensed (source-available) code to SDKs — they are Apache-2.0
- SDKs must not depend on collector internals — communicate only via OTLP
- Test against both the collector and a mock OTLP receiver
