import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

export const openai = new OpenAiCompatibleAdapter(
  "openai",
  ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5", "gpt-4.1", "gpt-4o"],
  "https://api.openai.com/v1",
);
