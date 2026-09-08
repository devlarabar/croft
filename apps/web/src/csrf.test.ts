import assert from "node:assert/strict";
import { test } from "node:test";
import { isCsrfRequest } from "./csrf";

const origin = "https://croft.test";
const formTypes = ["application/x-www-form-urlencoded", "multipart/form-data; boundary=abc", "text/plain", undefined];

test("native forms need either a matching Origin or same-origin Fetch Metadata", () => {
  for (const contentType of formTypes) {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const headers = new Headers();
      if (contentType) headers.set("Content-Type", contentType);
      assert.equal(isCsrfRequest(new Request(origin, { method, headers })), true);
      headers.set("Origin", "https://other.test");
      headers.set("Sec-Fetch-Site", "same-site");
      assert.equal(isCsrfRequest(new Request(origin, { method, headers })), true);
      headers.set("Origin", origin);
      assert.equal(isCsrfRequest(new Request(origin, { method, headers })), false);
      headers.set("Origin", "https://other.test");
      headers.set("Sec-Fetch-Site", "same-origin");
      assert.equal(isCsrfRequest(new Request(origin, { method, headers })), false);
    }
  }
});

test("Docker form origins match the request Host, not Next's listening address", () => {
  const headers = { host: "croft.test:8080", origin: "http://croft.test:8080" };
  const request = new Request("http://0.0.0.0:3000/settings", { method: "POST", headers });
  assert.equal(isCsrfRequest(request), false);
  request.headers.set("origin", "http://other.test");
  assert.equal(isCsrfRequest(request), true);
});

test("reads and non-form requests retain their CSRF exemption", () => {
  for (const method of ["GET", "HEAD"]) {
    assert.equal(isCsrfRequest(new Request(origin, { method })), false);
  }
  assert.equal(isCsrfRequest(new Request(origin, { method: "POST", headers: { "Content-Type": "application/json" } })), false);
});
