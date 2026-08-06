import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// The well-known local key exported by scripts/dev.sh. Refused unless dev
// auth bypass is on, so a deployment can't silently run with it.
const DEV_KEY = "63726f66742d6465762d6f6e6c79212163726f66742d6465762d6f6e6c792121";

// 32 bytes, hex-encoded. Defaults to TOKEN_ENC_KEY; rotate-key passes keys explicitly.
function key(hex = process.env.TOKEN_ENC_KEY!): Buffer {
  const keyBytes = Buffer.from(hex, "hex");
  if (keyBytes.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes of hex");
  if (hex === DEV_KEY && process.env.DEV_NO_AUTH !== "1") {
    throw new Error("TOKEN_ENC_KEY is the well-known dev key; set a real one (see README)");
  }
  return keyBytes;
}

// base64(iv | authTag | ciphertext)
export function encrypt(plaintext: string, keyHex?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyHex), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(encrypted: string, keyHex?: string): string {
  const buf = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(keyHex), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
