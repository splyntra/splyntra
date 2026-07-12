# SPDX-License-Identifier: Apache-2.0
"""Main Splyntra client - configures OTel pipeline targeting the Splyntra collector."""

from __future__ import annotations

from typing import Optional

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from splyntra.exporters import make_otlp_exporter, make_otlp_log_exporter
from splyntra.redaction import RedactingSpanProcessor


class Splyntra:
    """Initialize Splyntra tracing with one line.

    Usage:
        from splyntra import Splyntra
        splyntra = Splyntra(api_key="splyntra_...", project="my-project")

    Pass ``instrument=("langgraph", "openai")`` to auto-instrument frameworks,
    or call :func:`splyntra.instrument` separately.
    """

    def __init__(
        self,
        api_key: str,
        project: str,
        endpoint: str = "http://localhost:4318",
        environment: str = "development",
        service_name: Optional[str] = None,
        framework: Optional[str] = None,
        redact_by_default: bool = True,
        instrument: Optional[tuple] = None,
        guard: str = "off",
        guard_fail_open: bool = True,
    ):
        if not api_key:
            raise ValueError("Splyntra: api_key is required")
        if not project:
            raise ValueError("Splyntra: project is required")
        if guard not in ("off", "monitor", "block"):
            raise ValueError("Splyntra: guard must be 'off', 'monitor', or 'block'")

        self._api_key = api_key
        self.project = project
        self.endpoint = endpoint.rstrip("/")
        self.environment = environment
        self.framework = framework
        self.redact_by_default = redact_by_default

        resource_attrs = {
            "service.name": service_name or project,
            "splyntra.project": project,
            "splyntra.environment": environment,
            "deployment.environment": environment,
        }
        if framework:
            resource_attrs["splyntra.framework"] = framework
        resource = Resource.create(resource_attrs)

        exporter = make_otlp_exporter(self.endpoint, self._api_key, project)

        provider = TracerProvider(resource=resource)
        # Redaction runs before export so secrets never leave this process.
        if redact_by_default:
            provider.add_span_processor(RedactingSpanProcessor())
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        self._provider = provider
        self._tracer = trace.get_tracer("splyntra", __import__("splyntra").__version__)

        # Structured-logs pipeline: OTLP LogRecords → /v1/logs, trace-correlated,
        # so `splyntra.log.info(...)` works after one-line init.
        self._log_provider = self._setup_logs(resource)

        # Configure the inline guardrail (used by the instrumentors' pre-flight hook).
        from splyntra import guard as _guard

        _guard.configure(mode=guard, fail_open=guard_fail_open, endpoint=self.endpoint, api_key=self._api_key)

        if instrument:
            from splyntra.instrumentors import instrument as _instrument

            _instrument(*instrument)

    def _setup_logs(self, resource):
        """Set up the OTLP logs pipeline. Best-effort: if the OTel logs SDK isn't
        available, `splyntra.log` stays a no-op rather than breaking init."""
        try:
            from opentelemetry._logs import set_logger_provider
            from opentelemetry.sdk._logs import LoggerProvider
            from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

            log_provider = LoggerProvider(resource=resource)
            log_provider.add_log_record_processor(
                BatchLogRecordProcessor(
                    make_otlp_log_exporter(self.endpoint, self._api_key, self.project)
                )
            )
            set_logger_provider(log_provider)
            from splyntra import log as _log

            _log._configure(redact=self.redact_by_default)
            return log_provider
        except Exception:  # noqa: BLE001 — logs are optional; never break tracing init
            return None

    @property
    def tracer(self) -> trace.Tracer:
        return self._tracer

    def shutdown(self) -> None:
        """Flush and shut down the tracing + logs pipelines."""
        self._provider.shutdown()
        if getattr(self, "_log_provider", None) is not None:
            self._log_provider.shutdown()

    def __enter__(self) -> "Splyntra":
        return self

    def __exit__(self, *args) -> None:
        self.shutdown()
