// SPDX-License-Identifier: Apache-2.0
/**
 * Structured, trace-correlated logging for Splyntra.
 *
 * Emits OTLP LogRecords to the collector's `/v1/logs`. When called inside an
 * active span the log is auto-correlated (trace_id/span_id) so it lines up with
 * the trace waterfall. Bodies are redacted client-side (the collector also
 * redacts). No-op until `new Splyntra(...)` wires the LoggerProvider.
 *
 * Usage:
 *   import { splyntra } from "@splyntra/sdk"; // or the `log` export
 *   log.info("charging card", { amount: 42 });
 *   log.warn("rate limited", { server: "stripe" });
 */
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { redactString } from "./redaction";

type Attrs = Record<string, string | number | boolean>;

let ready = false;
let doRedact = true;

/** Called by the Splyntra client once the LoggerProvider is registered. */
export function configureLogs(redact: boolean): void {
  ready = true;
  doRedact = redact;
}

function emit(level: string, severity: SeverityNumber, message: string, attrs?: Attrs): void {
  if (!ready) return; // no-op until Splyntra() sets up the pipeline
  try {
    // The sdk-logs LoggerProvider attaches the active span context automatically.
    logs.getLogger("splyntra").emit({
      severityNumber: severity,
      severityText: level.toUpperCase(),
      body: doRedact ? redactString(message) : message,
      attributes: attrs,
    });
  } catch {
    /* logging must never break the caller */
  }
}

export const log = {
  debug: (message: string, attrs?: Attrs) => emit("debug", SeverityNumber.DEBUG, message, attrs),
  info: (message: string, attrs?: Attrs) => emit("info", SeverityNumber.INFO, message, attrs),
  warn: (message: string, attrs?: Attrs) => emit("warn", SeverityNumber.WARN, message, attrs),
  error: (message: string, attrs?: Attrs) => emit("error", SeverityNumber.ERROR, message, attrs),
  fatal: (message: string, attrs?: Attrs) => emit("fatal", SeverityNumber.FATAL, message, attrs),
};
