# SPDX-License-Identifier: Apache-2.0
"""OTLP exporter pre-configured for the Splyntra collector.

Centralises exporter construction so the client and any custom pipelines build
an identical, correctly-authenticated exporter.
"""

from __future__ import annotations

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

__all__ = ["make_otlp_exporter"]


def make_otlp_exporter(endpoint: str, api_key: str, project: str) -> OTLPSpanExporter:
    """Build an OTLP/HTTP span exporter targeting a Splyntra collector.

    Args:
        endpoint: Collector base URL, e.g. ``http://localhost:4318`` (no path).
        api_key: Splyntra API key, sent as a Bearer token.
        project: Project slug, sent as the ``X-Splyntra-Project`` header.
    """
    return OTLPSpanExporter(
        endpoint=f"{endpoint.rstrip('/')}/v1/traces",
        headers={
            "Authorization": f"Bearer {api_key}",
            "X-Splyntra-Project": project,
        },
    )
