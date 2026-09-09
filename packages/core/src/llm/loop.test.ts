import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { runAgentLoop, type AgentTool } from "./loop.js";
import type { ChatEvent, ChatRequest, ProviderAdapter } from "./types.js";

function fixture(turns: ChatEvent[][]) {
  const requests: ChatRequest[] = [];
  const reports: string[] = [];
  const tools: AgentTool[] = [{
    def: { name: "report", description: "Submit", inputSchema: { type: "object" } },
    schema: z.object({ summary: z.string() }),
    async execute(args) {
      reports.push(z.object({ summary: z.string() }).parse(args).summary);
      return [{ type: "text", text: "Recorded." }];
    },
  }];
  const adapter: ProviderAdapter = {
    id: "fixture",
    models: ["fixture"],
    async *chat(req) {
      requests.push(structuredClone(req));
      const turn = turns.shift();
      assert.ok(turn, "Unexpected extra model request");
      yield* turn;
    },
  };
  return {
    reports,
    requests,
    options: {
      adapter,
      cred: { kind: "api_key" as const, getToken: async () => "fixture" },
      model: "fixture",
      system: "Test the app and report.",
      messages: [],
      tools,
      completionTool: "report",
      onEvent: async () => {},
    },
  };
}

function submission(args: unknown = { summary: "Tested" }): ChatEvent {
  return { type: "tool_call", call: { id: "submission", name: "report", args } };
}

const stopped: ChatEvent[] = [
  { type: "text_delta", text: "All done." },
  { type: "done", stopReason: "end" },
];

test("text-only and truncated responses are incomplete, not done", async () => {
  for (const stopReason of ["end", "max_tokens"] as const) {
    const { options, reports } = fixture([[{ type: "done", stopReason }]]);
    const result = await runAgentLoop(options);
    assert.equal(result.outcome, "incomplete");
    assert.deepEqual(reports, []);
  }
});

test("a successful report stops immediately and skips subsequent tools", async () => {
  const { options, reports } = fixture([[submission(), submission({ summary: "Overwrite" })]]);
  const result = await runAgentLoop(options);
  assert.equal(result.outcome, "done");
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(reports, ["Tested"]);
  assert.equal(result.messages.filter((message) => message.role === "tool").length, 2);
});

test("forced submission retries invalid arguments with validation feedback", async () => {
  const { options, reports, requests } = fixture([[submission({})], [submission()]]);
  const result = await runAgentLoop({ ...options, toolChoice: "report", toolCallCap: 3 });
  assert.equal(result.outcome, "done");
  assert.deepEqual(reports, ["Tested"]);
  assert.ok(requests.every((req) => req.toolChoice === "report"));
  const feedback = requests[1]?.messages.find((message) => message.role === "tool");
  assert.ok(feedback?.role === "tool");
  assert.match(JSON.stringify(feedback.content), /Invalid arguments/);
});

test("forced submission can recover from a text-only response", async () => {
  const { options, reports } = fixture([stopped, [submission()]]);
  const result = await runAgentLoop({ ...options, toolChoice: "report", toolCallCap: 3 });
  assert.equal(result.outcome, "done");
  assert.deepEqual(reports, ["Tested"]);
});

test("repeated refusals or invalid submissions stop after three attempts", async () => {
  for (const turn of [stopped, [submission({})]]) {
    const { options, reports, requests } = fixture([turn, turn, turn]);
    const result = await runAgentLoop({ ...options, toolChoice: "report", toolCallCap: 3 });
    assert.equal(result.outcome, "incomplete");
    assert.equal(requests.length, 3);
    assert.deepEqual(reports, []);
  }
});

test("a failed report tool is not completion", async () => {
  const { options, reports } = fixture([[submission()], stopped]);
  const reportTool = options.tools[0];
  assert.ok(reportTool);
  options.tools[0] = {
    ...reportTool,
    async execute() { throw new Error("Cannot save report"); },
  };
  const result = await runAgentLoop(options);
  assert.equal(result.outcome, "incomplete");
  assert.deepEqual(reports, []);
  assert.match(JSON.stringify(result.messages), /Cannot save report/);
});

test("tool budget and deadline still bound exploration", async () => {
  const { options } = fixture([[submission({})]]);
  assert.equal((await runAgentLoop({ ...options, toolCallCap: 1 })).outcome, "cap_hit");
  assert.equal((await runAgentLoop({ ...options, deadlineAt: Date.now() - 1 })).outcome, "deadline_hit");
});
