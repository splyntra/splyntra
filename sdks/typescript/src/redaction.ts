// SPDX-License-Identifier: Apache-2.0
import { Context } from "@opentelemetry/api";
import { SpanProcessor, ReadableSpan, Span } from "@opentelemetry/sdk-trace-base";

/**
 * Client-side redaction patterns. Kept in sync with the collector's hot-path
 * redactor (apps/collector/internal/redact/redact.go) and the Python SDK so all
 * layers agree on what counts as a secret.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED:AWS_KEY]"],
  [/aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi, "[REDACTED:AWS_SECRET]"],
  [
    /(api[_-]?key|apikey|secret[_-]?key)\s*[=:]\s*["']?[A-Za-z0-9\-._~]{20,}["']?/gi,
    "[REDACTED:API_KEY]",
  ],
  [/bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "[REDACTED:BEARER]"],
  [/eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g, "[REDACTED:JWT]"],
];

/** Apply all redaction patterns to a string, returning the redacted copy. */
export function redactString(value: string): string {
  let result = value;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * A span processor that scrubs secrets from string attributes when a span ends.
 * Register it before the export processor so the shared span object is redacted
 * prior to export — the raw secret never leaves the process.
 */
export class RedactingSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    // no-op
  }

  onEnd(span: ReadableSpan): void {
    const attrs = span.attributes as Record<string, unknown>;
    if (!attrs) return;
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (typeof value === "string") {
        const redacted = redactString(value);
        if (redacted !== value) {
          attrs[key] = redacted;
        }
      } else if (Array.isArray(value)) {
        // OTel allows array-valued attributes (e.g. message lists, tool.args).
        // Redact string elements so secrets in arrays don't bypass scrubbing.
        let changed = false;
        const next = value.map((el) => {
          if (typeof el === "string") {
            const r = redactString(el);
            if (r !== el) changed = true;
            return r;
          }
          return el;
        });
        if (changed) attrs[key] = next;
      }
    }
  }

  async forceFlush(): Promise<void> {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}
