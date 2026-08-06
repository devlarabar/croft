import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "./crypto.js";
import { db, schema } from "./db/client.js";

// Re-encrypts every stored secret under NEW_TOKEN_ENC_KEY. Resumable: rows
// already readable with the new key are skipped, so a partial run can be
// retried. Usage:
//   DATABASE_URL=... TOKEN_ENC_KEY=<old> NEW_TOKEN_ENC_KEY=<new> pnpm --filter @croft/core rotate-key

const newKey = process.env.NEW_TOKEN_ENC_KEY;
if (!newKey || Buffer.from(newKey, "hex").length !== 32) {
  console.error("NEW_TOKEN_ENC_KEY must be 32 bytes of hex");
  process.exit(1);
}

// null = skip (already rotated, or undecryptable under either key).
function reencrypt(label: string, ciphertext: string): string | null {
  try {
    return encrypt(decrypt(ciphertext), newKey);
  } catch {
    try {
      decrypt(ciphertext, newKey);
      console.log(`${label}: already on new key, skipping`);
    } catch {
      console.warn(`${label}: does not decrypt under old or new key, skipping`);
    }
    return null;
  }
}

const credentialRows = await db.select().from(schema.credentials);
let rotated = 0;
for (const row of credentialRows) {
  const next = reencrypt(`credential ${row.id}`, row.encrypted);
  if (!next) continue;
  await db.update(schema.credentials).set({ encrypted: next }).where(eq(schema.credentials.id, row.id));
  rotated += 1;
}
console.log(`credentials: ${rotated}/${credentialRows.length} rotated`);

const [cfg] = await db.select().from(schema.config);
if (cfg) {
  let changed = false;
  for (const [repo, logins] of Object.entries(cfg.previewLogins)) {
    for (const login of logins) {
      const next = reencrypt(`preview login ${repo}/${login.username}`, login.encryptedPassword);
      if (!next) continue;
      login.encryptedPassword = next;
      changed = true;
    }
  }
  if (changed) {
    await db.update(schema.config).set({ previewLogins: cfg.previewLogins }).where(eq(schema.config.id, cfg.id));
  }
}

console.log("done — set TOKEN_ENC_KEY to the new key on the web container and worker job definition");
process.exit(0);
