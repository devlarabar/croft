import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { encryptEventPayload, decryptEventPayload } from "./event-payload.js";
import { encrypt } from "./crypto.js";
import { redact, redactDeep } from "./redact.js";

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

test("model tokens, authentication headers and credential fields are redacted", () => {
  const secrets = [
    `sk-proj-${"a".repeat(40)}`,
    `sk-ant-oat01-${"b".repeat(40)}`,
    `sk-${"c".repeat(32)}`,
    `eyJ${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`,
    `AKIA${"A".repeat(16)}`,
    "-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----",
  ];
  for (const secret of secrets) {
    assert.equal(redact(`before ${secret} after`), "before [redacted] after");
  }
  for (const field of ["apiKey", "api_key", "secretAccessKey", "access_token", "refreshToken", "id_token", "client_secret", "Authorization", "x-api-key", "TOKEN_ENC_KEY", "DATABASE_URL"]) {
    assert.equal(redact(`${field} = 'synthetic-secret'`), `${field} = '[redacted]'`);
    const source = { nested: [{ [field]: "synthetic-secret", status: 200 }] };
    assert.deepEqual(redactDeep(source), { nested: [{ [field]: "[redacted]", status: 200 }] });
    assert.equal(source.nested[0]?.[field], "synthetic-secret");
    assert.deepEqual(JSON.parse(redact(JSON.stringify(source))), redactDeep(source));
  }
  assert.equal(redact("Bearer synthetic-token"), "Bearer [redacted]");
  assert.equal(redact("Basic c3ludGhldGlj"), "Basic [redacted]");
  assert.equal(redact("postgresql://user:synthetic@db/test"), "postgresql://[redacted]@db/test");
  assert.equal(redact('apiKey: "synthetic\\\"secret"'), 'apiKey: "[redacted]"');
  assert.deepEqual(decryptEventPayload(encryptEventPayload({ secretAccessKey: "synthetic-secret" })), { secretAccessKey: "[redacted]" });
});

test("ordinary content and required preview logins remain usable", () => {
  const input = { model: "gpt-5", inputTokens: 20, password: "preview-password", text: "Reset your password", dataBase64: "aGVsbG8=" };
  assert.deepEqual(redactDeep(input), input);
});

test("legacy secrets are redacted when exported or read for Q&A", () => {
  const legacy = { nested: { apiKey: "synthetic-secret" } };
  const expected = { nested: { apiKey: "[redacted]" } };
  assert.deepEqual(decryptEventPayload(legacy), expected);
  assert.deepEqual(decryptEventPayload(encrypt(JSON.stringify(legacy))), expected);
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
