// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { redactString, RedactingSpanProcessor } from "./redaction";

describe("redactString", () => {
  it("redacts AWS access keys", () => {
    const out = redactString("key AKIAIOSFODNN7EXAMPLE end");
    expect(out).not.toContain("AKIA");
    expect(out).toContain("[REDACTED:AWS_KEY]");
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abc123def";
    expect(redactString(`token=${jwt}`)).toContain("[REDACTED:JWT]");
  });

  it("redacts bearer tokens and api keys", () => {
    expect(redactString("Authorization: Bearer abcDEF123.tok")).toContain("[REDACTED:BEARER]");
    expect(redactString('api_key="abcdef0123456789abcdef"')).toContain("[REDACTED:API_KEY]");
  });

  it("leaves clean text untouched", () => {
    const clean = "The agent planned a refund for order 42.";
    expect(redactString(clean)).toBe(clean);
  });
});

describe("RedactingSpanProcessor", () => {
  it("scrubs string attributes on span end", () => {
    const span: any = { attributes: { "splyntra.input": "key AKIAIOSFODNN7EXAMPLE", n: 5 } };
    new RedactingSpanProcessor().onEnd(span);
    expect(span.attributes["splyntra.input"]).not.toContain("AKIA");
    expect(span.attributes.n).toBe(5);
  });
});
