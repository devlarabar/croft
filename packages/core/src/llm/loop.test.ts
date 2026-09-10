import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { runAgentLoop, type AgentTool } from "./loop.js";
import type { ChatEvent, ChatRequest, ProviderAdapter } from "./types.js";

interface RecordedEvent {
  type: string;
  payload: unknown;
}

function fixture(turns: ChatEvent[][]) {
  const requests: ChatRequest[] = [];
  const events: RecordedEvent[] = [];
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
    events,
    options: {
      adapter,
      cred: { kind: "api_key" as const, getToken: async () => "fixture" },
      model: "fixture",
      system: "Test the app and report.",
      messages: [],
      tools,
      completionTool: "report",
      onEvent: async (type: string, payload: unknown) => { events.push({ type, payload }); },
    },
  };
}

function submission(args: unknown = { summary: "Tested" }): ChatEvent {
  return { type: "tool_call", call: { id: "submission", name: "report", args } };
}

function browserCall(name: string, selector = "missing"): ChatEvent {
  return { type: "tool_call", call: { id: `${name}-${selector}`, name, args: { selector } } };
}

function browserFixture(turns: ChatEvent[][]) {
  const setup = fixture(turns);
  const actions: string[] = [];
  const browser = { snapshots: 0, closed: false };
  setup.options.tools.push({
    def: { name: "browser_click", description: "Click", inputSchema: { type: "object" } },
    schema: z.object({ selector: z.string() }),
    recoveryTool: "browser_snapshot",
    async execute(args) {
      const { selector } = z.object({ selector: z.string() }).parse(args);
      actions.push(selector);
      if (selector === "missing") throw new Error("page.click: Timeout 10000ms exceeded");
      return [{ type: "text", text: "Clicked visible element." }];
    },
  }, {
    def: { name: "browser_snapshot", description: "Inspect", inputSchema: { type: "object" } },
    schema: z.object({}),
    async execute() {
      browser.snapshots++;
      if (browser.closed) throw new Error("Target page has been closed");
      return [{ type: "text", text: "button: visible" }];
    },
  });
  return { ...setup, actions, browser };
}

const stopped: ChatEvent[] = [
  { type: "text_delta", text: "All done." },
  { type: "done", stopReason: "end" },
];

test("text-only and truncated responses are incomplete, not done", async () => {
  for (const stopReason of ["end", "max_tokens"] as const) {
    const { options, reports } = fixture(Array.from({ length: 3 }, () => [{ type: "done", stopReason }]));
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
  const { options, reports } = fixture([[submission()], stopped, stopped, stopped]);
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

test("normal execution continues text-only replies without removing tools", async () => {
  const { options, reports, requests, events } = fixture([stopped, [submission()]]);
  const result = await runAgentLoop(options);
  assert.equal(result.outcome, "done");
  assert.deepEqual(reports, ["Tested"]);
  assert.deepEqual(requests[1]?.tools, requests[0]?.tools);
  assert.equal(events.filter((event) => event.type === "agent_continuation").length, 1);
});

test("a click timeout requires inspection and can recover from a tools-unavailable refusal", async () => {
  const { options, reports, requests, browser, actions, events } = browserFixture([
    [browserCall("browser_click")],
    [{ type: "text_delta", text: "The browser tools became unavailable." }],
    [browserCall("browser_snapshot")],
    [browserCall("browser_click", "visible")],
    [submission()],
  ]);
  const result = await runAgentLoop(options);
  assert.equal(result.outcome, "done");
  assert.equal(result.toolCalls, 4);
  assert.deepEqual(actions, ["missing", "visible"]);
  assert.equal(browser.snapshots, 1);
  assert.deepEqual(reports, ["Tested"]);
  assert.equal(requests[1]?.toolChoice, "browser_snapshot");
  assert.equal(requests[2]?.toolChoice, "browser_snapshot");
  assert.equal(requests[3]?.toolChoice, undefined);
  assert.ok(requests.every((request) => request.tools?.some((tool) => tool.name === "browser_click")));
  assert.ok(events.some((event) => event.type === "agent_recovery"));
  assert.deepEqual(events.at(-1), { type: "agent_loop_stopped", payload: { outcome: "done", toolCalls: 4, incompleteTurns: 0, recoveryTool: undefined } });
});

test("reports and further actions cannot bypass inspection, even in the failed action's batch", async () => {
  const { options, reports, actions, browser } = browserFixture([
    [browserCall("browser_click"), submission({ summary: "Interrupted" }), browserCall("browser_click", "visible")],
    [submission({ summary: "Still interrupted" })],
    [browserCall("browser_snapshot")],
    [submission({ summary: "Inspected the page" })],
  ]);
  const result = await runAgentLoop(options);
  assert.equal(result.outcome, "done");
  assert.deepEqual(reports, ["Inspected the page"]);
  assert.deepEqual(actions, ["missing"]);
  assert.equal(browser.snapshots, 1);
});

test("actions batched with inspection wait until the model has read its result", async () => {
  const { options, reports, actions } = browserFixture([
    [browserCall("browser_click")],
    [browserCall("browser_snapshot"), browserCall("browser_click", "stale"), submission({ summary: "Premature" })],
    [browserCall("browser_click", "visible")],
    [submission()],
  ]);
  const result = await runAgentLoop(options);
  assert.equal(result.outcome, "done");
  assert.deepEqual(actions, ["missing", "visible"]);
  assert.deepEqual(reports, ["Tested"]);
});

test("a genuinely closed browser can be reported after inspection also fails", async () => {
  const { options, browser, reports } = browserFixture([
    [browserCall("browser_click")], [browserCall("browser_snapshot")], [submission({ summary: "Page closed" })],
  ]);
  browser.closed = true;
  const result = await runAgentLoop(options);
  assert.equal(result.outcome, "done");
  assert.equal(browser.snapshots, 1);
  assert.deepEqual(reports, ["Page closed"]);
  assert.match(JSON.stringify(result.messages), /Target page has been closed/);
});

test("recovery attempts stay inside the original tool budget", async () => {
  const { options, browser, reports } = browserFixture([[browserCall("browser_click")]]);
  const result = await runAgentLoop({ ...options, toolCallCap: 1 });
  assert.equal(result.outcome, "cap_hit");
  assert.equal(result.toolCalls, 1);
  assert.equal(browser.snapshots, 0);
  assert.deepEqual(reports, []);
});

test("tool budget and deadline still bound exploration", async () => {
  const { options } = fixture([[submission({})]]);
  assert.equal((await runAgentLoop({ ...options, toolCallCap: 1 })).outcome, "cap_hit");
  assert.equal((await runAgentLoop({ ...options, deadlineAt: Date.now() - 1 })).outcome, "deadline_hit");
});
