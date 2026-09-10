import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { canAccess } from "./access";
import { Layout } from "./layout";

const runPath = "/runs/9fe4d6f2-c580-4acf-94c3-c5e5a994ccdb";
const viewPaths = ["/", "/runs", runPath, `${runPath}/video`];
const adminPaths = [`${runPath}/logs`, "/new", "/models", "/models/credential", "/models/active", "/chat", "/settings",
  "/users", "/learnings", "/export", "/api/export", "/api/purge", "/credcheck", "/keyfp",
  "/oauth/start", "/oauth/callback", "/oauth/paste", "/api/docs", "/api/openapi.json", "/future-route"];

test("users cannot access any dashboard page or action", () => {
  for (const path of [...viewPaths, ...adminPaths]) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
      assert.equal(canAccess("user", method, path), false, `${method} ${path}`);
    }
  }
});

test("members can only read runs and videos", () => {
  for (const path of viewPaths) {
    assert.equal(canAccess("member", "GET", path), true);
    assert.equal(canAccess("member", "HEAD", path), true);
    assert.equal(canAccess("member", "POST", path), false);
  }
  for (const path of [...adminPaths, `${runPath}/retry`, `${runPath}/cancel`]) {
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
      assert.equal(canAccess("member", method, path), false, `${method} ${path}`);
    }
  }
});

test("admins retain full dashboard access", () => {
  for (const path of [...viewPaths, ...adminPaths, `${runPath}/retry`, `${runPath}/cancel`]) {
    assert.equal(canAccess("admin", "GET", path), true);
    assert.equal(canAccess("admin", "POST", path), true);
  }
});

test("navigation only exposes permitted pages", () => {
  for (const role of ["user", "member", "admin"] as const) {
    const html = renderToStaticMarkup(<Layout title="Test" role={role}>Content</Layout>);
    assert.equal(html.includes('href="/runs"'), role !== "user");
    assert.equal(html.includes('href="/users"'), role === "admin");
    assert.equal(html.includes('href="/settings"'), role === "admin");
  }
});
