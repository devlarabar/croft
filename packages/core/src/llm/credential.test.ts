import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { db } from "../db/client.js";
import { encrypt } from "../crypto.js";
import { loadCredential } from "./credential.js";
import { openai } from "./adapters/openai.js";

for (const kind of ["api_key", "oauth"]) {
  test(`a mismatched ${kind} credential is rejected before decryption or refresh`, async (context) => {
    context.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{
      id: "fixture", providerId: "anthropic", kind, encrypted: "not-ciphertext", expiresAt: new Date(0),
    }] }) }));
    let requests = 0;
    context.mock.method(globalThis, "fetch", async () => { requests++; return new Response(""); });
    await assert.rejects(loadCredential("fixture", openai), /Credential provider does not match/);
    assert.equal(requests, 0);
  });
}

test("matching API-key credentials remain usable", async (context) => {
  const previousKey = process.env.TOKEN_ENC_KEY;
  process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");
  context.after(() => {
    if (previousKey === undefined) delete process.env.TOKEN_ENC_KEY;
    else process.env.TOKEN_ENC_KEY = previousKey;
  });
  const encrypted = encrypt("synthetic-key");
  context.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{
    id: "fixture", providerId: "openai", kind: "api_key", encrypted,
  }] }) }));
  const credential = await loadCredential("fixture", openai);
  assert.equal(await credential.getToken(), "synthetic-key");
});
