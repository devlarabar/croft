import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as exportRuns } from "./app/api/export/route";
import { GET as exportRunLogs } from "./app/runs/[id]/logs.json/route";
import { POST as purgeRuns } from "./app/api/purge/route";
import { GET as loginCallback } from "./app/login/callback/route";
import { POST as pasteOAuth } from "./app/oauth/paste/route";
import { getLatestActivity } from "./activity";
import { redirect, route } from "./http";
import { db, errorSummary, LlmTransportError } from "@croft/core";
import { POST as setActiveModel } from "./app/models/active/route";

test("errors never expose secret-bearing messages, stacks or causes", async (context) => {
  const logs: unknown[][] = [];
  context.mock.method(console, "error", (...args: unknown[]) => { logs.push(args); });
  for (const error of [
    new Error("synthetic-key", { cause: { password: "synthetic-key" } }),
    new SyntaxError("Unexpected token in synthetic-key"),
    new LlmTransportError("synthetic-key", 401),
  ]) {
    const handler = route(() => { throw error; });
    const response = await handler(new Request("https://croft.test/"), undefined);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "Something went wrong. Please try again.");
  }
  assert.deepEqual(logs, [
    ["Operation failed. Please retry."],
    ["Operation failed. Please retry."],
    ["Model request failed (HTTP 401). Check model access and retry."],
  ]);
  assert.equal(errorSummary(new LlmTransportError("synthetic-key")), "Model request failed. Check model access and retry.");
});

function postForm(path: string, fields: Record<string, string>): Request {
  return new Request(`https://croft.test${path}`, { method: "POST", body: new URLSearchParams(fields) });
}

test("redirects retain 302 semantics, relative URLs, and multibyte encoding", () => {
  for (const location of ["/runs", "/new?error=no%20preview%20URL"]) {
    const response = redirect(location);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), location);
  }
  assert.equal(redirect("/export?notice=Purge+not+confirmed+—+type+delete").headers.get("location"),
    "/export?notice=Purge+not+confirmed+%E2%80%94+type+delete");
});

test("a mismatched model credential leaves the active configuration unchanged", async (context) => {
  context.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{
    id: "fixture", providerId: "anthropic", kind: "api_key", encrypted: "not-ciphertext",
  }] }) }));
  const writes: unknown[] = [];
  context.mock.method(db, "insert", (...args: unknown[]) => { writes.push(args); throw new Error("Unexpected write"); });
  context.mock.method(db, "update", (...args: unknown[]) => { writes.push(args); throw new Error("Unexpected write"); });
  const response = await setActiveModel(postForm("/models/active", { model: "openai/gpt-5", credentialId: "fixture" }), undefined);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/models?notice=Select+a+credential+from+the+same+provider+as+the+model.");
  assert.deepEqual(writes, []);
});

test("invalid exports and unconfirmed purges do not reach storage", async () => {
  const response = await exportRuns(new Request("https://croft.test/api/export?before=invalid"), undefined);
  assert.equal(response.status, 400);
  assert.equal(await response.text(), "invalid date");
  const unconfirmed = await purgeRuns(postForm("/api/purge", { before: "2026-01-01" }), undefined);
  assert.equal(unconfirmed.status, 302);
  assert.equal(unconfirmed.headers.get("location"), "/export?notice=Purge+not+confirmed+%E2%80%94+type+delete");
  const invalid = await purgeRuns(postForm("/api/purge", { confirm: "delete", before: "invalid" }), undefined);
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), "invalid date");
});

test("invalid run log exports do not reach the database", async () => {
  const response = await exportRunLogs(new Request("https://croft.test/runs/invalid/logs.json"), { params: Promise.resolve({ id: "invalid" }) });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "404 Not Found");
});

test("OAuth callbacks and paste requests reject missing state", async () => {
  const callback = await loginCallback(new Request("https://croft.test/login/callback?state=invalid"), undefined);
  assert.equal(callback.status, 400);
  assert.equal(await callback.text(), "bad oauth state");
  const paste = await pasteOAuth(postForm("/oauth/paste", { code: "code" }), undefined);
  assert.equal(paste.status, 400);
  assert.equal(await paste.text(), "oauth session expired — start again");
});

test("the activity API fails closed before reading the database", async () => {
  delete process.env.CROFT_API_KEY;
  const missing = await getLatestActivity(new Request("https://croft.test/api/v1/activity"));
  assert.equal(missing.status, 500);
  assert.deepEqual(await missing.json(), { error: "CROFT_API_KEY is not configured" });
  process.env.CROFT_API_KEY = "test-key";
  const unauthorized = await getLatestActivity(new Request("https://croft.test/api/v1/activity", { headers: { "X-API-Key": "wrong-key" } }));
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });
});
