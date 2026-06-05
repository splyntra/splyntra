// SPDX-License-Identifier: Apache-2.0
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

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
