import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { anthropic } from "./adapters/anthropic.js";
import { codexOAuth } from "./adapters/openai-codex.js";
import { authorizeUrl, exchangeCode, generatePkce, parseOAuthRedirect, refreshAccessToken } from "./oauth.js";

const callback = new URL(codexOAuth.redirectUri);
callback.searchParams.set("code", "fixture-code");
callback.searchParams.set("state", "fixture-state");

test("OpenAI authorization includes PKCE, offline access and the registered localhost callback", () => {
  const pkce = generatePkce();
  assert.equal(pkce.challenge, createHash("sha256").update(pkce.verifier).digest("base64url"));
  const url = new URL(authorizeUrl(codexOAuth, pkce.challenge, "fixture-state"));
  assert.equal(url.origin, "https://auth.openai.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
  assert.equal(url.searchParams.get("redirect_uri"), codexOAuth.redirectUri);
  assert.equal(url.searchParams.get("code_challenge"), pkce.challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "fixture-state");
  assert.equal(url.searchParams.get("scope"), "openid profile email offline_access");
  assert.equal(url.searchParams.get("codex_cli_simplified_flow"), "true");
  assert.equal(url.searchParams.get("id_token_add_organizations"), "true");
  assert.equal(url.searchParams.has("code"), false);
});

test("pasted OpenAI callbacks must match the login state and registered redirect", () => {
  assert.equal(parseOAuthRedirect(` ${callback} `, codexOAuth, "fixture-state"), "fixture-code");
  for (const pasted of [
    "fixture-code",
    callback.toString().replace("fixture-state", "another-state"),
    callback.toString().replace("localhost", "attacker.example"),
    callback.toString().replace("1455", "3000"),
    callback.toString().replace("/auth/callback", "/other"),
    callback.toString().replace("fixture-code", ""),
    `${callback}&error=access_denied`,
    codexOAuth.redirectUri,
  ]) {
    assert.equal(parseOAuthRedirect(pasted, codexOAuth, "fixture-state"), null, pasted);
  }
});

test("OpenAI exchanges and refreshes tokens using form encoding", async (context) => {
  const requests: URLSearchParams[] = [];
  context.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, codexOAuth.tokenUrl);
    assert.equal(new Headers(init.headers).get("content-type"), "application/x-www-form-urlencoded");
    assert.ok(init.body instanceof URLSearchParams);
    requests.push(init.body);
    return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  });
  const before = Date.now();
  const tokens = await exchangeCode(codexOAuth, "code+with/symbols", "verifier");
  assert.equal(tokens.accessToken, "access");
  assert.equal(tokens.refreshToken, "refresh");
  assert.ok(tokens.expiresAt && tokens.expiresAt.getTime() >= before + 3600_000);
  assert.deepEqual(Object.fromEntries(requests[0] ?? []), {
    grant_type: "authorization_code", code: "code+with/symbols", client_id: codexOAuth.clientId,
    redirect_uri: codexOAuth.redirectUri, code_verifier: "verifier",
  });
  const refreshed = await refreshAccessToken(codexOAuth, "old-refresh");
  assert.equal(refreshed.accessToken, "access");
  assert.equal(refreshed.refreshToken, "refresh");
  assert.deepEqual(Object.fromEntries(requests[1] ?? []), {
    grant_type: "refresh_token", refresh_token: "old-refresh", client_id: codexOAuth.clientId,
  });
});

test("Anthropic still uses the code-paste flag and JSON token exchange including state", async (context) => {
  const cfg = anthropic.oauth;
  assert.ok(cfg);
  assert.equal(new URL(authorizeUrl(cfg, "challenge", "state")).searchParams.get("code"), "true");
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("content-type"), "application/json");
    assert.equal(typeof init.body, "string");
    if (typeof init.body !== "string") throw new Error("Expected JSON body");
    assert.deepEqual(JSON.parse(init.body), {
      grant_type: "authorization_code", code: "code", state: "state", client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri, code_verifier: "verifier",
    });
    return Response.json({ access_token: "access" });
  });
  assert.deepEqual(await exchangeCode(cfg, " code#state ", "verifier"), {
    accessToken: "access", refreshToken: undefined, expiresAt: undefined,
  });
});

test("OAuth token failures do not expose the endpoint body", async (context) => {
  context.mock.method(globalThis, "fetch", async () => new Response("secret-provider-body", { status: 400 }));
  await assert.rejects(exchangeCode(codexOAuth, "code", "verifier"), {
    message: "OAuth token endpoint returned 400. Reconnect from Models.",
  });
});

test("malformed token responses cannot become saved credentials", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ access_token: "" }));
  await assert.rejects(exchangeCode(codexOAuth, "code", "verifier"), z.ZodError);
});
