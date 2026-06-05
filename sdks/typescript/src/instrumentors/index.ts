// SPDX-License-Identifier: Apache-2.0
import { instrumentOpenAI } from "./openai";
import { instrumentLangGraph } from "./langgraph";

export { instrumentOpenAI, instrumentLangGraph };

type Instrumentor = () => boolean;

const REGISTRY: Record<string, Instrumentor> = {
  openai: instrumentOpenAI,
  langgraph: instrumentLangGraph,
};

/**
 * Enable framework auto-instrumentors. With no arguments, attempts every known
 * instrumentor (each is a safe no-op when its package is absent). Returns the
 * names that were successfully applied.
 */
export function instrument(...frameworks: string[]): string[] {
  const names = frameworks.length ? frameworks : Object.keys(REGISTRY);
  const enabled: string[] = [];
  for (const name of names) {
    const fn = REGISTRY[name];
    if (fn && fn()) enabled.push(name);
  }
  return enabled;
}
