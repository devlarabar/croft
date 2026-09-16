import assert from "node:assert/strict";
import { test } from "node:test";
import { azure } from "./azure.js";
import type { Credential } from "../types.js";

for (const resourceName of ["my-resource", "https://my-resource.openai.azure.com/"]) {
  test(`Azure sends its key only to the normalized resource: ${resourceName}`, async (context) => {
    let destination: string | undefined;
    context.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
      destination = new URL(url).origin;
      assert.equal(new Headers(options.headers).get("api-key"), "synthetic-key");
      return new Response("", { headers: { "content-type": "text/event-stream" } });
    });
    const cred: Credential = { kind: "api_key", getToken: async () => JSON.stringify({ apiKey: "synthetic-key", resourceName }) };
    for await (const event of azure.chat({ model: "fixture", messages: [] }, cred)) assert.equal(event.type, "done");
    assert.equal(destination, "https://my-resource.openai.azure.com");
  });
}

for (const resourceName of ["collector.example/", "https://collector.example/", "resource@collector.example/", "resource?query", "resource#fragment", "resource:443", "resource\\path", ""]) {
  test(`Azure rejects an unsafe resource before sending its key: ${resourceName}`, async (context) => {
    let requests = 0;
    context.mock.method(globalThis, "fetch", async () => { requests++; return new Response(""); });
    const cred: Credential = { kind: "api_key", getToken: async () => JSON.stringify({ apiKey: "synthetic-key", resourceName }) };
    await assert.rejects(async () => {
      for await (const event of azure.chat({ model: "fixture", messages: [] }, cred)) assert.fail(JSON.stringify(event));
    }, /Invalid Azure resource/);
    assert.equal(requests, 0);
  });
}
