import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

export const openai = new OpenAiCompatibleAdapter(
  "openai",
  ["gpt-5", "gpt-4.1", "gpt-4o"],
  "https://api.openai.com/v1",
);
