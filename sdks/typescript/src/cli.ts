#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Splyntra CLI — the evaluation CI gate (npm parity with the Python `splyntra eval`).
 *
 *   splyntra eval push --name support-qa --file dataset.jsonl
 *   splyntra eval run  --dataset <id> --file results.jsonl --gate
 *
 * `run --gate` exits 1 when the run is a regression, so it can block a CI release.
 * Reads SPLYNTRA_EVAL_ENDPOINT (default http://localhost:8002) and SPLYNTRA_API_KEY.
 */
import { readFileSync } from "fs";
import { pushDataset, runEval, DatasetItem, RunResult } from "./eval";

const DEFAULT_SCORERS = ["exact_match", "rule_based"];

function flag(name: string, def = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function has(name: string): boolean {
  return process.argv.includes(name);
}
function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l)) as T[];
}
function usage(): never {
  console.error(
    "usage:\n" +
      "  splyntra eval push --name <name> --file <dataset.jsonl> [--description <text>]\n" +
      "  splyntra eval run  --dataset <id> --file <results.jsonl> [--scorers a,b] [--gate] [--set-baseline] [--agent <id>] [--model <m>] [--version <n>]"
  );
  process.exit(2);
}

async function main(): Promise<number> {
  const [, , group, cmd] = process.argv;
  if (group !== "eval") usage();

  if (cmd === "push") {
    const name = flag("--name");
    const file = flag("--file");
    if (!name || !file) usage();
    const res = await pushDataset(name, readJsonl<DatasetItem>(file), { description: flag("--description") });
    console.log(JSON.stringify(res, null, 2));
    return 0;
  }

  if (cmd === "run") {
    const dataset = flag("--dataset");
    const file = flag("--file");
    if (!dataset || !file) usage();
    const scorers = flag("--scorers").split(",").filter(Boolean);
    const gate = has("--gate");
    const version = flag("--version");
    const res = await runEval(dataset, readJsonl<RunResult>(file), {
      scorers: scorers.length ? scorers : DEFAULT_SCORERS,
      gate,
      setBaseline: has("--set-baseline"),
      agentId: flag("--agent") || undefined,
      model: flag("--model") || undefined,
      version: version ? Number(version) : undefined,
    });
    console.log(JSON.stringify(res, null, 2));
    if (gate && !res.passed) {
      console.error("✗ evaluation gate FAILED (regression vs baseline)");
      return 1;
    }
    return 0;
  }

  usage();
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
