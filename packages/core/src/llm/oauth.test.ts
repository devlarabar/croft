import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { anthropic } from "./adapters/anthropic.js";
import { checkOpenAiDeviceCode, openaiOAuth, requestOpenAiDeviceCode } from "./openai-device.js";
import { authorizeUrl, exchangeCode, generatePkce, OAuthRequestError, refreshAccessToken } from "./oauth.js";

const device = { deviceAuthId: "device-fixture", userCode: "ABCD-EFGH", intervalSeconds: 5 };

test("device login exchanges OpenAI's approval code with its hosted callback and verifier", async (context) => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push(url);
    assert.equal(init.method, "POST");
    if (url.endsWith("/usercode")) {
      assert.deepEqual(JSON.parse(z.string().parse(init.body)), { client_id: openaiOAuth.clientId });
      return Response.json({ device_auth_id: device.deviceAuthId, user_code: device.userCode, interval: "5" });
    }
    if (url.endsWith("/deviceauth/token")) {
      assert.deepEqual(JSON.parse(z.string().parse(init.body)), { device_auth_id: device.deviceAuthId, user_code: device.userCode });
      return Response.json({ authorization_code: "approved-code", code_verifier: "server-verifier" });
    }
    assert.equal(new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded");
    assert.ok(init.body instanceof URLSearchParams);
    assert.deepEqual(Object.fromEntries(init.body), {
      grant_type: "authorization_code", code: "approved-code", code_verifier: "server-verifier",
      client_id: openaiOAuth.clientId, redirect_uri: "https://auth.openai.com/deviceauth/callback",
    });
    return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  });
  assert.deepEqual(await requestOpenAiDeviceCode(), device);
  const before = Date.now();
  const tokens = await checkOpenAiDeviceCode(device);
  assert.equal(tokens?.accessToken, "access");
  assert.equal(tokens?.refreshToken, "refresh");
  assert.ok(tokens?.expiresAt && tokens.expiresAt.getTime() >= before + 3600_000);
  assert.deepEqual(requests, [
    "https://auth.openai.com/api/accounts/deviceauth/usercode",
    "https://auth.openai.com/api/accounts/deviceauth/token",
    "https://auth.openai.com/oauth/token",
  ]);
});

test("device code responses accept Codex's usercode alias and enforce a positive polling interval", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ device_auth_id: "fixture", usercode: "CODE", interval: "0" }));
  assert.deepEqual(await requestOpenAiDeviceCode(), { deviceAuthId: "fixture", userCode: "CODE", intervalSeconds: 1 });
});

for (const status of [403, 404]) {
  test(`device approval status ${status} stays pending without exchanging tokens`, async (context) => {
    context.mock.method(globalThis, "fetch", async (url: string) => {
      assert.equal(url, "https://auth.openai.com/api/accounts/deviceauth/token");
      return new Response(null, { status });
    });
    assert.equal(await checkOpenAiDeviceCode(device), null);
  });
}

test("OAuth failures retain the failing step and status without exposing provider bodies", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("private body", { status: 429 }));
  for (const [operation, step] of [
    [requestOpenAiDeviceCode(), "device-code"],
    [checkOpenAiDeviceCode(device), "device-approval"],
    [exchangeCode(openaiOAuth, "code", "verifier"), "token"],
  ] as const) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof OAuthRequestError);
      assert.equal(error.step, step);
      assert.equal(error.status, 429);
      assert.equal(error.message.includes("private body"), false);
      return true;
    });
  }
});

test("malformed device approval and token responses cannot become saved credentials", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(requestOpenAiDeviceCode(), z.ZodError);
  await assert.rejects(checkOpenAiDeviceCode(device), z.ZodError);
  await assert.rejects(exchangeCode(openaiOAuth, "code", "verifier"), z.ZodError);
});

test("OpenAI refreshes tokens using form encoding", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, openaiOAuth.tokenUrl);
    assert.equal(new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded");
    assert.ok(init.body instanceof URLSearchParams);
    assert.deepEqual(Object.fromEntries(init.body), {
      grant_type: "refresh_token", refresh_token: "old-refresh", client_id: openaiOAuth.clientId,
    });
    return Response.json({ access_token: "access", refresh_token: "refresh" });
  });
  assert.deepEqual(await refreshAccessToken(openaiOAuth, "old-refresh"), {
    accessToken: "access", refreshToken: "refresh", expiresAt: undefined,
  });
});

test("Anthropic retains PKCE, the code-paste flag and JSON token exchange including state", async (context) => {
  const cfg = anthropic.oauth;
  const pkce = generatePkce();
  assert.equal(pkce.challenge, createHash("sha256").update(pkce.verifier).digest("base64url"));
  assert.equal(new URL(authorizeUrl(cfg, pkce.challenge, "state")).searchParams.get("code"), "true");
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(z.string().parse(init.body)), {
      grant_type: "authorization_code", code: "code", state: "state", client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri, code_verifier: pkce.verifier,
    });
    return Response.json({ access_token: "access" });
  });
  assert.deepEqual(await exchangeCode(cfg, " code#state ", pkce.verifier), {
    accessToken: "access", refreshToken: undefined, expiresAt: undefined,
  });
});
