import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { getOAuthState, sessionUser, setOAuthState, setSession } from "./session";

process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");

function cookieRequest(response: Response): Request {
  return new Request("https://croft.test/runs", { headers: { cookie: response.headers.getSetCookie().join("; ") } });
}

function legacySession(githubId: string, exp: number): Request {
  const payload = JSON.stringify({ githubId, exp });
  const signature = createHmac("sha256", String(process.env.TOKEN_ENC_KEY)).update(payload).digest("base64url");
  return new Request("https://croft.test/runs", {
    headers: { cookie: `croft_session=${Buffer.from(payload).toString("base64url")}.${signature}` },
  });
}

test("existing signed sessions remain valid, but expired and tampered cookies do not", () => {
  assert.equal(sessionUser(legacySession("122644200", Date.now() + 60_000)), "122644200");
  assert.equal(sessionUser(legacySession("122644200", Date.now() - 1)), null);
  assert.equal(sessionUser(new Request("https://croft.test/runs")), null);
  assert.equal(sessionUser(new Request("https://croft.test/runs", { headers: { cookie: "croft_session=payload.tampered" } })), null);
});

test("session cookies retain their lifetime and security attributes", () => {
  const response = new Response();
  setSession(response, "122644200");
  assert.equal(sessionUser(cookieRequest(response)), "122644200");
  const cookie = response.headers.getSetCookie().join();
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) {
    assert.ok(cookie.includes(attribute), attribute);
  }
});

test("OAuth state and PKCE verifier survive the redirect cookie", () => {
  const response = new Response();
  const state = { provider: "anthropic", state: "state", verifier: "verifier" };
  setOAuthState(response, state);
  const restored = getOAuthState(cookieRequest(response));
  assert.ok(restored);
  assert.equal(restored.provider, state.provider);
  assert.equal(restored.state, state.state);
  assert.equal(restored.verifier, state.verifier);
  assert.ok(response.headers.getSetCookie().join().includes("Max-Age=600"));
});
