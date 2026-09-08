import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const origin = "https://croft.test";

test("public endpoints stay public while all unknown dashboard paths require sign-in", async () => {
  delete process.env.DEV_NO_AUTH;
  for (const path of ["/api/v1/activity", "/login", "/login/callback", "/styles.css", "/favicon.ico"]) {
    assert.equal((await proxy(new NextRequest(origin + path))).headers.get("x-middleware-next"), "1");
  }
  const webhook = await proxy(new NextRequest(origin + "/api/webhooks/github", { method: "POST" }));
  assert.equal(webhook.headers.get("x-middleware-next"), "1");
  for (const path of ["/runs", "/settings", "/api/docs", "/api/local-runs", "/unknown", "/api/forms/settings"]) {
    const response = await proxy(new NextRequest(origin + path, { headers: { "x-croft-role": "admin" } }));
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get("location"), `${origin}/login`, path);
    assert.equal(response.headers.get("cache-control"), "private, no-store", path);
  }
});

test("anonymous redirects use an absolute public URL rather than the container address", async () => {
  delete process.env.DEV_NO_AUTH;
  for (const host of ["croft.test", "croft.test:8443"]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const request = new NextRequest("https://0.0.0.0:3000/runs?page=2", {
        method, headers: { host },
      });
      const response = await proxy(request);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `https://${host}/login`);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
  }
});

test("native form URLs rewrite internally only after authorization and CSRF checks", async () => {
  process.env.DEV_NO_AUTH = "1";
  for (const path of ["/runs", "/settings", "/learnings", "/users", "/chat"]) {
    const blocked = await proxy(new NextRequest(origin + path, { method: "POST", body: new URLSearchParams() }));
    assert.equal(blocked.status, 403, path);
    assert.equal(await blocked.text(), "Forbidden");
    const allowed = await proxy(new NextRequest(origin + path, {
      method: "POST", headers: { origin }, body: new URLSearchParams(),
    }));
    assert.equal(allowed.headers.get("x-middleware-rewrite"), `${origin}/api/forms${path}`);
    assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  }
  const internal = await proxy(new NextRequest(origin + "/api/forms/settings", {
    method: "POST", headers: { origin }, body: new URLSearchParams(),
  }));
  assert.equal(internal.status, 404);
});

test("pagination and unsupported methods retain their HTTP errors", async () => {
  process.env.DEV_NO_AUTH = "1";
  for (const page of ["0", "-1", "1.5", "bad", ""]) {
    const response = await proxy(new NextRequest(`${origin}/runs?page=${page}`));
    assert.equal(response.status, 400);
    assert.equal(await response.text(), "invalid page");
  }
  const options = await proxy(new NextRequest(origin + "/runs", { method: "OPTIONS", headers: { origin } }));
  assert.equal(options.status, 404);
  const local = await proxy(new NextRequest(origin + "/api/local-runs", { method: "POST" }));
  assert.equal(local.headers.get("x-middleware-next"), "1");
});
