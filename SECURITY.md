# Security Policy

Splyntra is a security product for AI agents. We take security seriously.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x (current) | ✅ Active development |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please report vulnerabilities via one of these channels:

1. **Email:** security@splyntra.dev
2. **GitHub Security Advisories:** [Report a vulnerability](https://github.com/splyntra/splyntra/security/advisories/new)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment:** Within 48 hours
- **Triage:** Within 5 business days
- **Fix timeline:** Depends on severity (Critical: 7 days, High: 14 days, Medium: 30 days)

## Disclosure Policy

- We follow coordinated disclosure — we'll work with you on timing.
- Credit will be given to reporters (unless you prefer anonymity).
- We will not take legal action against good-faith security researchers.

## Scope

The following are in scope:

- The collector service (authentication, authorization, input validation)
- The security detection pipeline (false negatives, bypasses)
- The dashboard (XSS, CSRF, authentication bypasses)
- SDKs (credential leakage, unsafe defaults)
- Docker Compose / deployment configurations (exposed services, default creds)

## Security Design Principles

- **Redact by default** — Sensitive data is stripped before persistent storage.
- **Least privilege** — Services communicate over internal networks only.
- **No default credentials in production** — All secrets require explicit `.env` configuration.
- **Tenant isolation** — All queries are scoped by org_id + project_id.
