import { createHash } from "node:crypto";
import { z } from "zod";

export function keyFingerprint(): string {
  return createHash("sha256").update(z.string().parse(process.env.TOKEN_ENC_KEY)).digest("hex").slice(0, 8);
}
