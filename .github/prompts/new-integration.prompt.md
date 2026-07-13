---
description: "Create a new third-party integration adapter for Splyntra. Use when adding support for a new AI platform (e.g., LangGraph, AutoGen, Semantic Kernel)."
---

# New Integration

Create a new integration adapter for platform: ${input:platform_name}

## Steps

1. Create directory `integrations/${input:platform_name}/`
2. Add a `README.md` with setup instructions and configuration
3. Implement the adapter following the pattern in existing integrations (see `integrations/n8n-nodes-splyntra/` or `integrations/openclaw-plugin-splyntra/`)
4. Add SPDX license header (Apache-2.0) to all new files
5. Register the integration in `docs/INTEGRATIONS.md`

## Requirements

- Must emit standard OpenTelemetry spans via the Splyntra SDK
- Must not depend on collector internals — SDK-only integration
- Include a working example in the README
- Follow the naming pattern: `integrations/<platform>/` for docs-only, `integrations/<platform>-plugin-splyntra/` for code packages
