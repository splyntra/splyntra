# Job Application Agent with Splyntra Observability & Governance

> Based on [ashishpatel26/500-AI-Agents-Projects (18-job-application-agent)](https://github.com/ashishpatel26/500-AI-Agents-Projects/tree/main/agents/18-job-application-agent), supercharged with end-to-end **Splyntra** monitoring, guardrails, security detection, and governance.

This example orchestrates a multi-agent system (using [CrewAI](https://github.com/crewAIInc/crewAI) and [OpenAI](https://platform.openai.com/)) that analyzes job postings and candidate profiles to generate an elite job application package:
1. **Job Requirements & Culture Analysis**
2. **Market Compensation & Salary Benchmarks** (via custom tool)
3. **Tailored High-Impact Resume Bullets** (XYZ formula)
4. **Targeted 3-Paragraph Cover Letter & 10 Interview Questions**

---

## What Splyntra Monitors

Splyntra captures and secures **every single aspect** of the agent lifecycle:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Splyntra Dashboard                                 │
│                                                                             │
│  [Trace Waterfall]                                                          │
│  ▼ job_application_agent (root agent workflow)                [450ms]       │
│    ├─► splyntra.guard.enforce (pre-flight prompt inspection)   [ 15ms]       │
│    ├─► splyntra.authorize (governance policy evaluation)       [ 20ms]       │
│    ▼ crew: job_application_crew                               [410ms]       │
│      ├─► task: Deconstruct Job Description                    [120ms]       │
│      │   ├─► tool: company_intel.culture_lookup               [ 50ms]       │
│      │   └─► llm.gpt-4o-mini (prompt: 480 tok, compl: 190 tok) [ 70ms]      │
│      ├─► task: Analyze Market Compensation                    [100ms]       │
│      │   ├─► tool: market_data.salary_benchmark               [ 80ms]       │
│      │   └─► llm.gpt-4o-mini (prompt: 510 tok, compl: 210 tok) [ 20ms]      │
│      ├─► task: Craft High-Impact Resume Bullets               [ 95ms]       │
│      │   └─► llm.gpt-4o-mini (prompt: 540 tok, compl: 250 tok) [ 95ms]      │
│      └─► task: Generate Cover Letter & Interview Prep         [ 95ms]       │
│          └─► llm.gpt-4o-mini (prompt: 620 tok, compl: 380 tok) [ 95ms]      │
│    └─► splyntra.log_action (immutable ledger audit append)     [ 15ms]       │
│                                                                             │
│  [Trace-Correlated Logs]                                                    │
│  • INFO  - Initializing job application generation workflow                 │
│  • INFO  - Querying market salary database (job_title=..., location=...)     │
│  • INFO  - Job application package generated and audited to ledger           │
│                                                                             │
│  [Security & Redaction]                                                     │
│  • PII (Candidate email & phone) automatically redacted client-side         │
│  • Inline Guardrail blocks / monitors prompt injections                     │
│  • Secret detection and token tracking across all steps                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Dimension | How It's Monitored in Splyntra |
|---|---|
| **Root Agent Workflow** | `@trace_agent(name="job_application_agent", workflow="career_materials_generation")` wraps the pipeline into a single root span. |
| **Multi-Agent Tasks** | `instrument=("crewai", "openai")` auto-instruments CrewAI crew kickoffs and each sequential task step. |
| **Tool Execution** | `@trace_tool` decorates `market_data.salary_benchmark` and `company_intel.culture_lookup`, recording latency, arguments, and returned payloads. |
| **LLM Calls & Tokens** | `@trace_llm` and OpenAI auto-instrumentation capture model name (`gpt-4o-mini`), prompt/completion tokens, and execution durations. |
| **Structured Logs** | `splyntra.log.info / warn / debug` emits OTLP log records auto-correlated with the active trace ID, visible alongside spans in the waterfall. |
| **Inline Guardrails** | `splyntra.guard.enforce()` performs pre-flight scans on external job postings and candidate profiles before sending them to LLMs. |
| **Client-Side Redaction** | `redact_by_default=True` strips sensitive candidate PII (phone, email, credentials) before spans leave the process. |
| **Governance & Ledger** | `splyntra.authorize()` validates execution policy, while `splyntra.log_action()` appends an audit record to Splyntra's immutable ledger. |

---

## Repository Structure

```
examples/job-application-agent/
├── python/                  # Python implementation (CrewAI + splyntra SDK)
│   ├── agent.py
│   ├── requirements.txt
│   ├── sample_job.txt
│   ├── sample_candidate.txt
│   ├── .env.example
│   └── .env
└── typescript/              # TypeScript / JavaScript implementation (@splyntra/sdk)
    ├── agent.ts
    ├── package.json
    ├── tsconfig.json
    ├── sample_job.txt
    ├── sample_candidate.txt
    ├── .env.example
    └── .env
```

---

## Quickstart

### 1. Start Splyntra

```bash
# In the root repository directory
docker compose up -d
```

### 2. Run Python Multi-Agent Pipeline

```bash
cd examples/job-application-agent/python
pip install -r requirements.txt
cp .env.example .env

# Production Run with Groq (Fast & Free Tier):
python agent.py --provider groq

# Run Splyntra Evaluation Benchmark & CI Gate:
python agent.py --eval

# Prompt Injection Security & Guardrail Demo:
python agent.py --mock --demo-injection --guard block

# Governance Human-in-the-Loop Approval Demo:
python agent.py --mock --demo-approval

# Instant Offline Simulation Mode:
python agent.py --mock
```

### 3. Run TypeScript / JavaScript Multi-Agent Pipeline

```bash
cd examples/job-application-agent/typescript
cp .env.example .env

# Run simulation:
npx tsx agent.ts --mock

# Run Splyntra Evaluation Benchmark:
npx tsx agent.ts --eval

# Test Governance Human-in-the-Loop Approval:
npx tsx agent.ts --mock --demo-approval

# Test Prompt Injection Guardrail in Strict Blocking Mode:
npx tsx agent.ts --mock --demo-injection --guard block
```

---

## Inspecting in Splyntra Dashboard

Open **http://localhost:3000/traces** in your browser:
1. Click on the `job_application_agent` trace.
2. Inspect the **nested execution waterfall**: see each agent's execution time, tool invocations, and LLM token usage.
3. Check **Trace Logs**: inspect correlated log entries produced at each phase.
4. Review **Security & Detections**: verify redaction of candidate PII and any flagged security warnings.
5. Check **Activity Ledger**: verify the audit record created on successful package generation.
