import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropic } from "./anthropic.js";
import { openai } from "./openai.js";
import { azure } from "./azure.js";
import { bedrock } from "./bedrock.js";
import { LlmTransportError, type Credential } from "../types.js";

for (const provider of [
  { adapter: anthropic, model: "fixture", token: "synthetic-key" },
  { adapter: openai, model: "fixture", token: "synthetic-key" },
  { adapter: azure, model: "fixture", token: JSON.stringify({ apiKey: "synthetic-key", resourceName: "fixture" }) },
  { adapter: bedrock, model: "openai.gpt-5.6-sol", token: JSON.stringify({ accessKeyId: "fixture", secretAccessKey: "synthetic-key", region: "us-east-1" }) },
]) {
  test(`${provider.adapter.id} errors retain retry metadata without the provider body`, async (context) => {
    context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { message: "synthetic-key" } }), {
      status: 429, headers: { "content-type": "application/json", "retry-after": "2" },
    }));
    const cred: Credential = { kind: "api_key", getToken: async () => provider.token };
    await assert.rejects(async () => {
      for await (const event of provider.adapter.chat({ model: provider.model, messages: [] }, cred)) assert.fail(JSON.stringify(event));
    }, (error: unknown) => {
      assert.ok(error instanceof LlmTransportError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 2000);
      assert.equal(String(error.stack).includes("synthetic-key"), false);
      return true;
    });
  });
}

test("OpenAI transport errors do not expose network causes", async (context) => {
  context.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("synthetic-key", { cause: new Error("synthetic-key") });
  });
  await assert.rejects(async () => {
    for await (const event of openai.chat({ model: "fixture", messages: [] }, { kind: "api_key", getToken: async () => "synthetic-key" })) {
      assert.fail(JSON.stringify(event));
    }
  }, (error: unknown) => {
    assert.ok(error instanceof LlmTransportError);
    assert.equal(error.message, "openai request failed. Please retry.");
    assert.equal(error.cause, undefined);
    return true;
  });
});
