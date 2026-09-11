import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { runAgentLoop } from "../loop.js";
import { type ChatEvent, type ChatRequest, type Credential, LlmTransportError } from "../types.js";
import { openai } from "./openai.js";

const token = `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "account-fixture" },
})).toString("base64url")}.signature`;
const credential: Credential = { kind: "oauth", getToken: async () => token };
const request: ChatRequest = {
  model: "gpt-6-astra", system: "Test the page", maxTokens: 100,
  messages: [
    { role: "user", content: [{ type: "text", text: "Click save" }] },
    { role: "assistant", content: "Clicking", toolCalls: [{ id: "call_1", name: "click", args: { x: 10 } }] },
    { role: "tool", toolCallId: "call_1", content: [
      { type: "text", text: "Saved" }, { type: "image", mediaType: "image/png", dataBase64: "cG5n" },
    ] },
  ],
  tools: [{ name: "report", description: "Submit", inputSchema: { type: "object" } }],
  toolChoice: "report",
};

async function collect(req = request, cred = credential): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of openai.chat(req, cred)) events.push(event);
  return events;
}

function sse(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

test("the GPT-6 picker uses OpenAI's documented Astra identifier", () => {
  assert.deepEqual(openai.models.filter((model) => model.startsWith("gpt-6")), ["gpt-6-astra"]);
});

test("OAuth uses Codex with account auth, vision, tool history and forced tool choice", async (context) => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse([
        { type: "response.created" },
        { type: "response.output_text.delta", delta: "Done" },
        { type: "response.completed", response: {
          output: [{ type: "function_call", call_id: "call_2", name: "report", arguments: '{"passed":true}' }],
          usage: { input_tokens: 20, output_tokens: 5, input_tokens_details: { cached_tokens: 10 } },
        } },
      ])));
    },
    cancel() { cancelled = true; },
  });
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://chatgpt.com/backend-api/codex/responses");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${token}`);
    assert.equal(headers.get("chatgpt-account-id"), "account-fixture");
    assert.equal(init.method, "POST");
    const json: unknown = JSON.parse(z.string().parse(init.body));
    assert.deepEqual(json, {
      model: "gpt-6-astra", instructions: "Test the page", stream: true, store: false,
      input: [
        { role: "user", content: [{ type: "input_text", text: "Click save" }] },
        { role: "assistant", content: [{ type: "output_text", text: "Clicking" }] },
        { type: "function_call", call_id: "call_1", name: "click", arguments: '{"x":10}' },
        { type: "function_call_output", call_id: "call_1", output: "Saved" },
        { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,cG5n", detail: "auto" }] },
      ],
      tools: [{ type: "function", name: "report", description: "Submit", parameters: { type: "object" }, strict: false }],
      tool_choice: { type: "function", name: "report" },
    });
    return new Response(body);
  });
  assert.deepEqual(await collect(), [
    { type: "text_delta", text: "Done" },
    { type: "tool_call", call: { id: "call_2", name: "report", args: { passed: true } } },
    { type: "done", stopReason: "tool_use", usage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 10, cacheWriteTokens: 0 } },
  ]);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

const reviewCall = { type: "function_call", call_id: "review_1", name: "submit_review", arguments: '{"score":95}' };

for (const output of [undefined, [], [reviewCall]]) {
  test(`streamed review submission completes once with terminal output ${JSON.stringify(output)}`, async (context) => {
    context.mock.method(globalThis, "fetch", async () => new Response(sse([
      { type: "response.output_item.added", item: { ...reviewCall, arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: "item_1", delta: '{"score":' },
      { type: "response.function_call_arguments.done", item_id: "item_1", arguments: reviewCall.arguments },
      { type: "response.output_item.done", item: reviewCall },
      { type: "response.completed", response: { output, usage: { input_tokens: 126231, output_tokens: 344 } } },
    ])));
    const submitted: unknown[] = [];
    const events: string[] = [];
    const result = await runAgentLoop({
      adapter: openai, cred: credential, model: request.model, system: "Review this PR.",
      messages: [{ role: "user", content: [{ type: "text", text: "Submit your review." }] }],
      tools: [{
        def: { name: "submit_review", description: "Submit", inputSchema: { type: "object" } },
        schema: z.object({ score: z.number() }),
        async execute(args) { submitted.push(args); return []; },
      }],
      completionTool: "submit_review", toolChoice: "submit_review", toolCallCap: 3,
      async onEvent(type) { events.push(type); },
    });
    assert.equal(result.outcome, "done");
    assert.equal(result.toolCalls, 1);
    assert.deepEqual(submitted, [{ score: 95 }]);
    assert.deepEqual(events, ["agent_loop_started", "usage", "tool_call", "tool_result", "agent_loop_stopped"]);
  });
}

test("OpenAI API keys still use chat completions", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer api-key");
    return new Response('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  assert.deepEqual(await collect({ ...request, model: "gpt-4o" }, { kind: "api_key", getToken: async () => "api-key" }), [
    { type: "text_delta", text: "Hello" }, { type: "done", stopReason: "end" },
  ]);
});

for (const event of [undefined, { type: "response.failed" }, { type: "error" }, {
  type: "response.incomplete", response: { output: [], incomplete_details: { reason: "content_filter" } },
}]) {
  test(`Codex rejects unsuccessful or truncated streams: ${event?.type ?? "no terminal event"}`, async (context) => {
    context.mock.method(globalThis, "fetch", async () => new Response(sse([
      { type: "response.output_item.done", item: reviewCall },
      ...(event ? [event] : []),
    ])));
    const emitted: ChatEvent[] = [];
    await assert.rejects(async () => {
      for await (const item of openai.chat(request, credential)) emitted.push(item);
    }, LlmTransportError);
    assert.deepEqual(emitted, []);
  });
}

test("output limits do not execute partial tool calls", async (context) => {
  const partial = { ...reviewCall, arguments: "{" };
  context.mock.method(globalThis, "fetch", async () => new Response(sse([
    { type: "response.output_item.done", item: partial },
    { type: "response.incomplete", response: {
      output: [partial], incomplete_details: { reason: "max_output_tokens" },
    } },
  ])));
  assert.deepEqual(await collect(), [{ type: "done", stopReason: "max_tokens" }]);
});

test("Codex rate limits retain retry metadata without exposing the response body", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("private body", { status: 429, headers: { "retry-after": "2" } }));
  await assert.rejects(collect(), (error: unknown) => {
    assert.ok(error instanceof LlmTransportError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 2000);
    assert.equal(error.message.includes("private body"), false);
    return true;
  });
});

test("aborted requests preserve the abort error", async (context) => {
  const controller = new AbortController();
  controller.abort();
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.signal, controller.signal);
    throw controller.signal.reason;
  });
  await assert.rejects(collect({ ...request, signal: controller.signal }), controller.signal.reason);
});
