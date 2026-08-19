# Browser Agent with Splyntra Observability & Security Governance

> Seamless monitoring, security guardrails, URL governance, and tamper-evident audit ledgers for [Browser Use](https://github.com/browser-use/browser-use) (~99k stars) autonomous web-browsing agents.

---

## The Challenge with Autonomous Browser Agents

Browser agents interact with real websites, executing complex multi-step workflows: navigating to URLs, clicking buttons, typing form inputs, extracting unstructured DOM tables, capturing screenshots, and downloading files.

This introduces unique production risks:
1. **Indirect Prompt Injection**: Malicious instructions hidden on third-party web pages attempt to hijack the agent and exfiltrate confidential credentials or internal tokens.
2. **PII & Credential Exfiltration**: Agents typing passwords, API tokens, and user PII into untrusted web forms.
3. **URL & Navigation Governance**: Autonomous agents wandering onto unapproved domains, competitor portals, or phishing sites.
4. **Token & Vision Cost Overhead**: High-frequency multi-modal screenshot reasoning and DOM snapshots consume substantial token budgets.

---

## How Splyntra Protects & Monitors Browser Agents

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Splyntra Dashboard                                 │
│                                                                             │
│  [Browser Action Waterfall]                                                 │
│  ▼ browser_agent (root web research workflow)                  [650ms]      │
│    ├─► splyntra.authorize (URL governance allowlisting)        [ 15ms]      │
│    ├─► tool: browser.navigate (https://github.com/trending)    [150ms]      │
│    ├─► tool: browser.screenshot (viewport: 1280x800)           [ 40ms]      │
│    ├─► llm.llama-3.3-70b-versatile (DOM vision reasoning)      [140ms]      │
│    ├─► tool: browser.click (button[aria-label='Filter'])       [ 60ms]      │
│    ├─► tool: browser.type (input#language, 'Python')           [ 80ms]      │
│    ├─► tool: browser.extract (div.trending-container)          [ 25ms]      │
│    │   └─► splyntra.guard.enforce (indirect injection check)   [ 10ms]      │
│    └─► splyntra.log_action (immutable ledger audit append)     [ 15ms]      │
│                                                                             │
│  [Security & Redaction]                                                     │
│  • Pre-navigation URL allowlisting blocks unauthorized domains              │
│  • Indirect prompt injections on web pages intercepted before LLM ingestion │
│  • Passwords & PII typed into forms automatically redacted client-side      │
│                                                                             │
│  [Trace-Correlated Logs]                                                    │
│  • INFO - Evaluating URL governance policy (target_url=...)                 │
│  • INFO - Extracting web page DOM content (bytes=1420)                      │
│  • INFO - Browser activity audited to Splyntra immutable ledger             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Splyntra Pillar | Browser Agent Capability |
|---|---|
| **Observability** | Full action waterfall tracking every `navigate`, `click`, `type`, `extract`, and `screenshot` with millisecond latency. |
| **Token & Cost Analytics** | Multi-modal vision token tracking, prompt/completion ratios, and per-step USD cost calculations. |
| **URL Governance** | `splyntra.authorize("browser.navigate", ...)` evaluates domain allowlists before any network request is initiated. |
| **Indirect Injection Defense** | `splyntra.guard.enforce(extracted_content)` scans scraped HTML to neutralize hidden prompts before LLM reasoning. |
| **Client-Side Redaction** | Strips sensitive passwords, session tokens, and user PII before spans leave the local machine. |
| **Immutable Ledger** | `splyntra.log_action()` records cryptographic, tamper-evident audit logs of all visited pages and extracted records. |
| **Correlated Logging** | `splyntra.log` emits OTLP log records tied directly to active trace IDs in the dashboard. |

---

## Repository Structure

```
examples/browser-use-agent/
├── python/                  # Python implementation (splyntra SDK)
│   ├── agent.py
│   ├── requirements.txt
│   ├── .env.example
│   └── .env
└── typescript/              # TypeScript / JavaScript implementation (@splyntra/sdk)
    ├── agent.ts
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    └── .env
```

---

## Quickstart

### 1. Start Splyntra

```bash
docker compose up -d
```

### 2. Run Python Agent

```bash
cd examples/browser-use-agent/python
pip install -r requirements.txt
cp .env.example .env

# Run with Groq Free Tier (Llama 3.3 70B):
python agent.py --provider groq

# Run simulation:
python agent.py --mock

# Test URL Governance Allowlisting & Domain Blocking:
python agent.py --mock --demo-url-block

# Test Indirect Web Prompt Injection Defense (Strict Blocking):
python agent.py --mock --demo-web-injection --guard block
```

### 3. Run TypeScript / JavaScript Agent

```bash
cd examples/browser-use-agent/typescript
cp .env.example .env

# Run simulation:
npx tsx agent.ts --mock

# Test URL Governance Allowlisting & Domain Blocking:
npx tsx agent.ts --mock --demo-url-block

# Test Indirect Web Prompt Injection Defense (Strict Blocking):
npx tsx agent.ts --mock --demo-web-injection --guard block
```

---

## Inspecting in Splyntra Dashboard

Open **http://localhost:3000/traces** in your browser:
1. Click on the `browser_agent` trace.
2. Inspect the **nested execution waterfall**: see DOM selectors, load times, screenshot proofs, and token costs.
3. Check **Security Detections**: inspect indirect prompt injection warnings and PII redaction.
4. Check **Activity Ledger**: review the cryptographic audit record of the completed web browsing session.
