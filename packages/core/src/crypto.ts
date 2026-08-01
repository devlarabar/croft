import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// TOKEN_ENC_KEY: 32 bytes, hex-encoded.
function key(): Buffer {
  const k = Buffer.from(process.env.TOKEN_ENC_KEY!, "hex");
  if (k.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes of hex");
  return k;
}

// base64(iv | authTag | ciphertext)
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(encrypted: string): string {
  const buf = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
