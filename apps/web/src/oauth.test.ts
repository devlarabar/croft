import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { GET as start } from "./app/oauth/start/route";
import { GET as deviceStart, POST as deviceCheck } from "./app/oauth/openai/route";
import { getOAuthState, getOpenAiDeviceState, setOpenAiDeviceState, type OpenAiDeviceState } from "./session";

process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");
const state: OpenAiDeviceState = {
  deviceAuthId: "device-fixture", userCode: "ABCD-EFGH", intervalSeconds: 5,
  expiresAt: Date.now() + 900_000, nextCheckAt: 0,
};

function deviceRequest(response: Response): Request {
  return new Request("https://croft.test/oauth/openai", {
    method: "POST", headers: { cookie: response.headers.getSetCookie().join("; ") },
  });
}

test("OpenAI login displays a device code and approval link, without a localhost callback", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    device_auth_id: state.deviceAuthId, user_code: state.userCode, interval: "5",
  }));
  const redirect = await start(new Request("https://croft.test/oauth/start?provider=openai"), undefined);
  assert.equal(redirect.headers.get("location"), "/oauth/openai");
  const response = await deviceStart(new Request("https://croft.test/oauth/openai"), undefined);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /https:\/\/auth.openai.com\/codex\/device/);
  assert.match(html, /ABCD-EFGH/);
  assert.match(html, /Check connection/);
  assert.doesNotMatch(html, /localhost|device-fixture/);
  const stored = getOpenAiDeviceState(deviceRequest(response));
  assert.ok(stored);
  assert.equal(stored.deviceAuthId, state.deviceAuthId);
  assert.ok(stored.nextCheckAt > Date.now());
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=900"]) {
    assert.match(response.headers.getSetCookie().join(), new RegExp(attribute));
  }
});

test("pending approval retains the code and deadline, and throttles repeated checks", async (context) => {
  const response = new Response();
  setOpenAiDeviceState(response, state);
  let polls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    polls++;
    return new Response(null, { status: 403 });
  });
  const pending = await deviceCheck(deviceRequest(response), undefined);
  assert.equal(pending.status, 200);
  assert.match(await pending.text(), /Approval is not confirmed yet/);
  const stored = getOpenAiDeviceState(deviceRequest(pending));
  assert.equal(stored?.expiresAt, state.expiresAt);
  assert.equal(stored?.userCode, state.userCode);
  const repeated = await deviceCheck(deviceRequest(pending), undefined);
  assert.match(await repeated.text(), /Approval is not confirmed yet/);
  assert.equal(polls, 1);
});

test("expired and tampered device sessions require a new login without contacting OpenAI", async (context) => {
  context.mock.method(globalThis, "fetch", async () => { throw new Error("Must not contact OpenAI"); });
  const expired = new Response();
  setOpenAiDeviceState(expired, { ...state, expiresAt: Date.now() - 1 });
  const tampered = new Response(null, { headers: { "set-cookie": "croft_openai_device=bad.signature" } });
  for (const response of [expired, tampered, new Response()]) {
    const result = await deviceCheck(deviceRequest(response), undefined);
    assert.equal(result.headers.get("location"), "/models?notice=OpenAI+login+expired.+Please+connect+again.");
  }
});

test("provider failures clear the device session and log only safe diagnostics", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("secret provider body", { status: 500 }));
  const logs: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  const response = new Response();
  setOpenAiDeviceState(response, state);
  const failed = await deviceCheck(deviceRequest(response), undefined);
  assert.equal(failed.headers.get("location"), "/models?notice=OAuth+connection+failed.+Please+connect+again.");
  assert.equal(getOpenAiDeviceState(deviceRequest(failed)), null);
  assert.deepEqual(logs, [["OAuth connection failed", { providerId: "openai", step: "device-approval", status: 500 }]]);
});

test("Anthropic login retains its code-paste instructions and verifier-as-state", async () => {
  const response = await start(new Request("https://croft.test/oauth/start?provider=anthropic"), undefined);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /provider will show you a code/);
  const state = getOAuthState(new Request("https://croft.test/oauth/paste", {
    headers: { cookie: response.headers.getSetCookie().join("; ") },
  }));
  assert.ok(state);
  assert.equal(state.state, state.verifier);
});
