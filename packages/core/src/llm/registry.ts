import { anthropic } from "./adapters/anthropic.js";
import { openai } from "./adapters/openai.js";
import type { ProviderAdapter } from "./types.js";

// Providers are code, not data. Adding one = new adapter + entry here + deploy.
export const PROVIDERS: Record<string, ProviderAdapter> = {
  [anthropic.id]: anthropic,
  [openai.id]: openai,
};

export function getProvider(id: string): ProviderAdapter {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`unknown provider ${id}`);
  return p;
}
