# Splyntra Event Schema

Shared event and span schema used across all services. This is the single source of truth for the data model.

## Structure

```
schema/
└── proto/
    └── splyntra/v1/
        └── events.proto    # Core trace, span, detection types
```

## Key Types

| Type | Description |
|------|-------------|
| `Trace` | A complete agent execution (root of the hierarchy) |
| `Span` | A single step: agent, llm_call, tool_call, or step |
| `Detection` | A security finding (PII, secret, injection) attached to a span |

## Design Principles

- **OTel-compatible**: Aligns with OpenTelemetry trace spec semantics
- **Extensions via attributes**: Custom metadata in `map<string, string>`
- **Security-first**: Risk score and detections are first-class fields, not afterthoughts
- **Replay-ready**: `input_preview` and `output_preview` enable step-by-step reconstruction

## Generating Code

```bash
# Go (from repo root)
buf generate schema/proto

# Or with protoc directly:
protoc --go_out=schema/gen/go --go_opt=paths=source_relative \
  schema/proto/splyntra/v1/events.proto
```

Currently, the collector uses hand-written Go structs that mirror this schema.
Proto codegen will be added when the schema stabilizes.
