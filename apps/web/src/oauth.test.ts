import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { GET as start } from "./app/oauth/start/route";
import { POST as paste } from "./app/oauth/paste/route";
import { getOAuthState } from "./session";

process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");

test("OpenAI login stays in Croft with callback-paste instructions and rejects mismatched state", async () => {
  const response = await start(new Request("https://croft.test/oauth/start?provider=openai"), undefined);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /sign in with your ChatGPT account/);
  assert.match(html, /copy its full URL/);
  assert.match(html, /name="code"/);
  const cookie = response.headers.getSetCookie().join("; ");
  const request = new Request("https://croft.test/oauth/paste", {
    method: "POST", headers: { cookie },
    body: new URLSearchParams({ code: "http://localhost:1455/auth/callback?code=fixture&state=wrong" }),
  });
  const state = getOAuthState(request);
  assert.ok(state);
  assert.equal(state.provider, "openai");
  assert.notEqual(state.state, state.verifier);
  const rejected = await paste(request, undefined);
  assert.equal(rejected.status, 400);
  assert.match(await rejected.text(), /Paste the full URL from this login attempt/);
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
