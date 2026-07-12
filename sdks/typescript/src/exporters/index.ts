// SPDX-License-Identifier: Apache-2.0
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";

/**
 * Build an OTLP/HTTP span exporter targeting a Splyntra collector. Centralises
 * exporter construction so the client and any custom pipelines build an
 * identical, correctly-authenticated exporter.
 */
export function makeOtlpExporter(
  endpoint: string,
  apiKey: string,
  project: string
): OTLPTraceExporter {
  return new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Splyntra-Project": project,
    },
  });
}

/** Build an OTLP/HTTP log exporter targeting a Splyntra collector's /v1/logs. */
export function makeOtlpLogExporter(
  endpoint: string,
  apiKey: string,
  project: string
): OTLPLogExporter {
  return new OTLPLogExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/logs`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Splyntra-Project": project,
    },
  });
}
