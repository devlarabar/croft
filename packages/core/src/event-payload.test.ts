import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { encryptEventPayload, decryptEventPayload } from "./event-payload.js";

const previousKey = process.env.TOKEN_ENC_KEY;
process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");
after(() => {
  if (previousKey === undefined) delete process.env.TOKEN_ENC_KEY;
  else process.env.TOKEN_ENC_KEY = previousKey;
});

const payload = { name: "browser_type", args: { selector: "input", text: "test-password" } };

test("event payloads round-trip without storing browser inputs in readable JSON", () => {
  const encrypted = encryptEventPayload(payload);
  assert.equal(JSON.stringify(encrypted).includes("test-password"), false);
  assert.deepEqual(decryptEventPayload(JSON.parse(JSON.stringify(encrypted))), payload);
  assert.notEqual(encryptEventPayload(payload), encrypted);
});

test("known token formats are redacted before encryption", () => {
  const encrypted = encryptEventPayload({ nested: { text: `ghp_${"a".repeat(30)}` } });
  assert.deepEqual(decryptEventPayload(encrypted), { nested: { text: "[redacted]" } });
});

test("legacy object payloads remain readable during rollout", () => {
  assert.deepEqual(decryptEventPayload(payload), payload);
});

test("corrupted ciphertext fails rather than being treated as a legacy payload", () => {
  const corrupted = Buffer.from(encryptEventPayload(payload), "base64");
  corrupted.writeUInt8(corrupted.readUInt8(12) ^ 1, 12);
  assert.throws(() => decryptEventPayload(corrupted.toString("base64")));
  assert.throws(() => decryptEventPayload("not-ciphertext"));
});

test("non-object event payloads are rejected at the write and read boundaries", () => {
  for (const invalid of [null, [], 42]) {
    assert.throws(() => encryptEventPayload(invalid));
    assert.throws(() => decryptEventPayload(invalid));
  }
});
