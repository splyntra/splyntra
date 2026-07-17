// SPDX-License-Identifier: FSL-1.1-ALv2
/**
 * Splyntra TypeScript / JavaScript Quickstart
 * ===========================================
 * Time-to-first-trace in under five minutes from a Node app.
 *
 * Uses function wrappers (wrapAgent / wrapTool / wrapLLM), which work in both
 * TypeScript and plain JavaScript — no decorators or build config required.
 *
 * Prerequisites:
 *     docker compose up -d        # start Splyntra
 *     npm install @splyntra/sdk
 *
 * Run:
 *     npx tsx examples/quickstart.ts        # TypeScript
 *     # plain JS: rename imports to require() and `node quickstart.js`
 *
 * Then open http://localhost:3000/traces to see your trace.
 */

import { Splyntra, wrapAgent, wrapTool, wrapLLM } from "@splyntra/sdk";

// 1. Initialize Splyntra (one line).
const splyntra = new Splyntra({
  apiKey: "splyntra_dev_key",
  project: "quickstart-ts",
  framework: "custom",
});

// 2. Wrap your agent's steps. wrapLLM reads `usage` for token/cost analytics.
const planResearch = wrapLLM(async (query: string) => {
  await new Promise((r) => setTimeout(r, 100)); // simulate latency
  return { searchQuery: `latest research on ${query}`, usage: { prompt_tokens: 150, completion_tokens: 45 } };
}, "gpt-4o", "openai");

const searchWeb = wrapTool(async (q: string) => {
  await new Promise((r) => setTimeout(r, 200));
  return [{ title: "Result 1", snippet: "Relevant info..." }];
}, "web.search");

const summarize = wrapLLM(async (_results: unknown) => {
  await new Promise((r) => setTimeout(r, 150));
  return { content: "Summary of findings.", usage: { prompt_tokens: 320, completion_tokens: 88 } };
}, "gpt-4o-mini", "openai");

const researchAgent = wrapAgent(async (query: string) => {
  const plan = await planResearch(query);
  const results = await searchWeb(plan.searchQuery);
  const summary = await summarize(results);
  return summary.content;
}, "research_agent", "summarize");

// 3. Run it.
async function main() {
  console.log("Running research agent...");
  const result = await researchAgent("AI agent observability");
  console.log(`Result: ${result}`);
  console.log("\n✓ Trace sent! View at http://localhost:3000/traces");
  await splyntra.shutdown(); // flush before the process exits
}

main();
