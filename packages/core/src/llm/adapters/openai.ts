import type { ProviderAdapter } from "../types.js";
import { openaiOAuth } from "../openai-device.js";
import { codexChat } from "./openai-codex.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

const apiKey = new OpenAiCompatibleAdapter(
  "openai",
  ["gpt-6", "gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5", "gpt-4.1", "gpt-4o"],
  "https://api.openai.com/v1",
);

export const openai: ProviderAdapter = {
  id: apiKey.id,
  models: apiKey.models,
  oauth: openaiOAuth,
  chat: (req, cred) => cred.kind === "oauth" ? codexChat(req, cred) : apiKey.chat(req, cred),
};
