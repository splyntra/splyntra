---
description: "Add a new security detector to the detection pipeline. Use when implementing a new threat detection pattern (e.g., SQL injection detector, toxicity detector)."
---

# New Detector

Add a new security detector: ${input:detector_name}

## Steps

1. Create detector module in `apps/security/detectors/${input:detector_name}.py`
2. Implement the `Detector` protocol (see existing detectors in that directory)
3. Register in the detector registry
4. Add ClickHouse enum value in a new migration: `migrations/clickhouse/xxx_detector_enum_expand.sql`
5. Write tests in `apps/security/tests/test_${input:detector_name}.py`
6. Add SPDX header (AGPL-3.0) to all new files

## Detector Protocol

```python
class Detector(Protocol):
    name: str
    def detect(self, span: Span) -> list[Detection]: ...
```

## Requirements

- Must be stateless (no instance-level caching between spans)
- Return structured `Detection` objects with severity, evidence, and remediation
- Include at least 5 positive and 5 negative test cases
- Document false-positive rate expectations in docstring
