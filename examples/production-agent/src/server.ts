// SPDX-License-Identifier: FSL-1.1-ALv2
// Deployable HTTP service wrapping the triage agent. Production essentials:
// fail-fast config, liveness/readiness endpoints (k8s probes), a per-request
// timeout with real cancellation, body-size limits, structured logs, and a
// graceful SIGTERM drain that flushes telemetry before exit.
//
// Telemetry is initialized FIRST so the openai instrumentor patches the client
// before any agent code constructs it.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { initTelemetry, shutdownTelemetry } from "./telemetry.js";
import { createTriageAgent, TimeoutError, withTimeout, type TicketInput } from "./agent.js";
import { log } from "./log.js";

const MAX_BODY_BYTES = 64 * 1024;

// ── Fail-fast bootstrap ───────────────────────────────────────────────
let config;
try {
  config = loadConfig();
} catch (err) {
  log.error("invalid configuration", { error: (err as Error).message });
  process.exit(1);
}

initTelemetry(config);
const triage = createTriageAgent(config);

let inFlight = 0;
let draining = false;

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function validateTicket(body: unknown): TicketInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const ticketId = typeof b.ticketId === "string" && b.ticketId.trim() ? b.ticketId.trim() : randomUUID();
  const customerEmail = typeof b.customerEmail === "string" ? b.customerEmail.trim() : "";
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!customerEmail.includes("@")) throw Object.assign(new Error("customerEmail is required"), { status: 400 });
  if (!message) throw Object.assign(new Error("message is required"), { status: 400 });
  return { ticketId, customerEmail, message };
}

async function handleTriage(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
  const ticket = validateTicket(await readJsonBody(req));
  const ac = new AbortController();
  const started = performance.now();
  try {
    const result = await withTimeout(triage(ticket, ac), config!.requestTimeoutMs, ac, "triage");
    log.info("triage completed", {
      requestId,
      ticketId: result.ticketId,
      category: result.category,
      priority: result.priority,
      durationMs: Math.round(performance.now() - started),
    });
    send(res, 200, result);
  } catch (err) {
    if (err instanceof TimeoutError) {
      log.warn("triage timed out", { requestId, error: err.message });
      send(res, 504, { error: "agent timed out" });
      return;
    }
    throw err;
  }
}

const server = createServer((req, res) => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("x-request-id", requestId);

  // Probes — keep them dependency-free and fast.
  if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { status: "ok" });
  if (req.method === "GET" && req.url === "/readyz") {
    return draining ? send(res, 503, { status: "draining" }) : send(res, 200, { status: "ready" });
  }

  if (req.method === "POST" && req.url === "/triage") {
    if (draining) return send(res, 503, { error: "server is shutting down" });
    inFlight++;
    handleTriage(req, res, requestId)
      .catch((err) => {
        const status = (err as { status?: number }).status ?? 500;
        if (status >= 500) log.error("request failed", { requestId, error: (err as Error).message });
        if (!res.headersSent) send(res, status, { error: (err as Error).message });
      })
      .finally(() => {
        inFlight--;
      });
    return;
  }

  send(res, 404, { error: "not found" });
});

server.listen(config.port, () => {
  log.info("listening", { port: config!.port, environment: config!.env });
});

// ── Graceful shutdown ─────────────────────────────────────────────────
// Stop advertising ready, stop accepting connections, let in-flight requests
// finish, flush telemetry, then exit. A hard deadline guards against a hung
// request so the orchestrator's SIGKILL is never what tears us down.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  draining = true;
  log.info("shutdown initiated", { signal, inFlight });

  const hardDeadline = setTimeout(() => {
    log.error("shutdown grace period exceeded — forcing exit", { inFlight });
    process.exit(1);
  }, 25000);
  hardDeadline.unref();

  server.close();
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 50));
  await shutdownTelemetry(); // flush buffered spans
  clearTimeout(hardDeadline);
  log.info("shutdown complete");
  process.exit(0);
}

// The SDK constructor installs its own SIGTERM/SIGINT handlers that flush and
// immediately process.exit(0) — that would cut our drain short. Take ownership:
// drop those listeners and run shutdown ourselves (we flush via shutdownTelemetry).
process.removeAllListeners("SIGTERM");
process.removeAllListeners("SIGINT");
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
