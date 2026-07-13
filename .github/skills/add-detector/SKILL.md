---
name: add-detector
description: "Add a new security or compliance detector to the detection pipeline. Use when implementing threat detection patterns like PII detection, prompt injection, toxicity, or custom regex-based detectors."
---

# Add Detector

## When to Use

- Implementing a new security detection pattern
- Adding a compliance check (PII, secrets, prompt injection, toxicity)
- Extending the detector registry with a custom pattern

## Architecture

Detectors run in two places:
1. **Go collector** (`apps/collector/internal/`) — fast regex/heuristic patterns inline with ingest
2. **Python security service** (`apps/security/detectors/`) — ML-based or heavy analysis

Choose based on latency requirements:
- Sub-millisecond, regex-based → Go collector
- ML model, external API, complex NLP → Python security service

## Procedure (Python Security Service)

### 1. Create Detector Module

```
apps/security/detectors/<detector_name>.py
```

Implement the Detector protocol:
```python
# SPDX-License-Identifier: AGPL-3.0-only

from dataclasses import dataclass

@dataclass
class Detection:
    detector: str
    severity: str  # "critical" | "high" | "medium" | "low"
    evidence: str
    remediation: str

class MyDetector:
    name = "my_detector"

    def detect(self, span: dict) -> list[Detection]:
        """Analyze a span and return any detections."""
        detections = []
        # ... detection logic
        return detections
```

### 2. Register in the Detector Registry

Add to the detector list in the service's main router/registry.

### 3. Add ClickHouse Enum Value

Create a new migration:
```sql
-- migrations/clickhouse/NNN_detector_enum_expand.sql
ALTER TABLE detections MODIFY COLUMN detector_type Enum8(
    ... existing values ...,
    'my_detector' = N
);
```

### 4. Write Tests

```
apps/security/tests/test_<detector_name>.py
```

Requirements:
- At least 5 positive cases (should detect)
- At least 5 negative cases (should NOT detect)
- Edge cases (unicode, empty input, very long input)
- Document expected false-positive rate

### 5. Verify

```bash
cd apps/security
pip install -e ".[dev]"
pytest tests/test_<detector_name>.py -v
ruff check detectors/<detector_name>.py
```

## Procedure (Go Collector — Fast Path)

For regex/heuristic detectors that must run inline:

1. Add pattern to `apps/collector/internal/redact/` or create new package under `internal/`
2. Register in the ingest pipeline
3. Table-driven tests with `t.Run()`
4. Benchmark with `go test -bench=.`

## Constraints

- Detectors must be **stateless** — no instance-level caching between spans
- AGPL-3.0 license header on all files
- Python detectors must not block the event loop (use async if calling external APIs)
- Go detectors must not add more than 1ms p99 latency to the ingest path
