import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { ChatRequest, Credential } from "../types.js";
import { anthropic, anthropicRequestBody } from "./anthropic.js";
import { azure } from "./azure.js";
import { bedrock } from "./bedrock.js";
import { openai } from "./openai.js";

const request: ChatRequest = {
  model: "fixture",
  messages: [{ role: "user", content: [{ type: "text", text: "Submit now." }] }],
  tools: [{ name: "report", description: "Submit", inputSchema: { type: "object" } }],
  toolChoice: "report",
};

const bodySchema = z.object({ tool_choice: z.unknown() });

test("Anthropic and Bedrock Claude request bodies force the named tool only when requested", () => {
  assert.deepEqual(anthropicRequestBody(request, undefined).tool_choice, { type: "tool", name: "report" });
  assert.equal(anthropicRequestBody({ ...request, toolChoice: undefined }, undefined).tool_choice, undefined);
});

for (const provider of [
  { adapter: anthropic, model: "claude-sonnet-4-5", token: "fixture", choice: { type: "tool", name: "report" } },
  { adapter: openai, model: "gpt-5", token: "fixture", choice: { type: "function", function: { name: "report" } } },
  {
    adapter: azure,
    model: "gpt-5-5-se",
    token: JSON.stringify({ apiKey: "fixture", resourceName: "fixture" }),
    choice: { type: "function", function: { name: "report" } },
  },
  {
    adapter: bedrock,
    model: "openai.gpt-5.6-sol",
    token: JSON.stringify({ accessKeyId: "fixture", secretAccessKey: "fixture", region: "us-east-1" }),
    choice: { type: "function", name: "report" },
  },
]) {
  test(`${provider.adapter.id} sends forced tool choice to the provider`, async (context) => {
    const bodies: unknown[] = [];
    context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      assert.equal(typeof init.body, "string");
      if (typeof init.body !== "string") throw new Error("Expected JSON request body");
      bodies.push(bodySchema.parse(JSON.parse(init.body)).tool_choice);
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    });
    const cred: Credential = { kind: "api_key", getToken: async () => provider.token };
    for await (const event of provider.adapter.chat({ ...request, model: provider.model }, cred)) {
      assert.equal(event.type, "done");
    }
    assert.deepEqual(bodies, [provider.choice]);
  });
}
