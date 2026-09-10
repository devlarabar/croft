import { z } from "zod";
import { decrypt, encrypt } from "./crypto.js";
import { redactDeep } from "./redact.js";

const payloadSchema = z.record(z.string(), z.unknown());

export function encryptEventPayload(payload: unknown): string {
  return encrypt(JSON.stringify(redactDeep(payloadSchema.parse(payload))));
}

export function decryptEventPayload(payload: unknown) {
  // Legacy rows remain readable while old workers drain and the backfill runs.
  const value = typeof payload === "string" ? JSON.parse(decrypt(payload)) : payload;
  return payloadSchema.parse(value);
}
