import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { ChatEvent, ChatRequest, ProviderAdapter } from "@croft/core/llm/types";

let closed = 0;
mock.module("./browser.js", {
  namedExports: {
    openBrowserSession: async () => ({
      tools: [], screenshots: [],
      close: async () => { closed++; return null; },
    }),
  },
});
const { executeTestRun } = await import("./testrun.js");

interface RecordedEvent {
  type: string;
  payload: unknown;
}

async function execute(turns: ChatEvent[][], toolCallCap = 20) {
  const requests: ChatRequest[] = [];
  const events: RecordedEvent[] = [];
  const adapter: ProviderAdapter = {
    id: "fixture", models: ["fixture"],
    async *chat(request) {
      requests.push(structuredClone(request));
      const turn = turns.shift();
      assert.ok(turn, "Unexpected model request");
      yield* turn;
    },
  };
  const closedBefore = closed;
  const result = await executeTestRun({
    runId: "fixture", previewUrl: "https://preview.example.com", plan: "1. Open the note.",
    logins: [], repoContext: null, adapter, model: "fixture", toolCallCap,
    cred: { kind: "api_key", getToken: async () => "fixture" },
    emit: async (type, payload) => { events.push({ type, payload }); },
  });
  assert.equal(closed, closedBefore + 1);
  return { result, requests, events };
}

const refusal: ChatEvent[] = [{ type: "text_delta", text: "Browser tools became unavailable." }];
const skippedReport = {
  summary: "Interrupted",
  steps: [{ step: "1. Open the note.", status: "not_reached", notes: "Interrupted" }],
};
function submission(args: unknown): ChatEvent[] {
  return [{ type: "tool_call", call: { id: "report", name: "report", args } }];
}

test("salvaging a skipped report after repeated refusals records an execution error", async () => {
  const { result, requests, events } = await execute([refusal, refusal, refusal, submission(skippedReport)]);
  assert.equal(result.status, "error");
  assert.equal(result.report?.steps[0]?.notes, result.error);
  assert.equal(result.report?.summary, result.error);
  assert.equal(JSON.stringify(result.report).includes("Interrupted"), false);
  assert.equal(result.error, "Croft ended browser execution because the model stopped using tools after repeated continuation requests.");
  assert.equal(requests.at(-1)?.toolChoice, "report");
  assert.match(JSON.stringify(requests.at(-1)?.messages), /removed by Croft solely to collect the final report/);
  assert.ok(events.some((event) => event.type === "test_run_phase"));
  assert.deepEqual(events.at(-1), { type: "test_run_finished", payload: { status: "error", outcome: "incomplete", error: result.error } });
});

test("budget-limited report collection preserves the actual stop reason", async () => {
  const { result } = await execute([submission(skippedReport)], 0);
  assert.equal(result.status, "cap_hit");
  assert.equal(result.error, "Croft ended browser execution because the tool-call budget was reached.");
});

test("missing blocker notes are rejected but genuine untestable steps remain partial", async () => {
  const invalid = { summary: "Blocked", steps: [{ step: "1. Open the note.", status: "not_reached" }] };
  const valid = { summary: "No test data", steps: [{ step: "1. Open the note.", status: "not_reached", notes: "The account has no notes and no test-setup endpoint is available." }] };
  const { result, requests } = await execute([submission(invalid), submission(valid)]);
  assert.equal(result.status, "partial");
  assert.equal(result.error, null);
  assert.deepEqual(result.report, valid);
  assert.match(JSON.stringify(requests[1]?.messages), /Skipped steps must name the specific observed blocker/);
});

test("a completed plan still passes without forced report collection", async () => {
  const report = { summary: "Note opened", steps: [{ step: "1. Open the note.", status: "pass", notes: "The note is visible." }] };
  const { result, events } = await execute([submission(report)]);
  assert.equal(result.status, "passed");
  assert.equal(result.error, null);
  assert.deepEqual(result.report, report);
  assert.ok(!events.some((event) => event.type === "test_run_phase"));
});
