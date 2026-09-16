import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { decrypt, encrypt } from "../crypto.js";
import { refreshAccessToken } from "./oauth.js";
import type { Credential, OAuthConfig, ProviderAdapter } from "./types.js";

interface OAuthBlob {
  accessToken: string;
  refreshToken?: string;
}

export class CredentialProviderMismatchError extends Error {
  constructor() {
    super("Credential provider does not match the selected model.");
  }
}

const refreshing = new Map<string, Promise<string>>(); // single-flight per credential

export async function loadCredential(credentialId: string, provider: ProviderAdapter): Promise<Credential> {
  const [row] = await db
    .select()
    .from(schema.credentials)
    .where(eq(schema.credentials.id, credentialId));
  if (!row) throw new Error("Credential not found. Select a saved credential in Models.");
  if (row.providerId !== provider.id) throw new CredentialProviderMismatchError();

  if (row.kind === "api_key") {
    return { kind: "api_key", getToken: async () => decrypt(row.encrypted) };
  }

  return {
    kind: "oauth",
    getToken: () => {
      const inflight = refreshing.get(row.id);
      if (inflight) return inflight;
      const pending = oauthToken(row, provider.oauth).finally(() => refreshing.delete(row.id));
      refreshing.set(row.id, pending);
      return pending;
    },
  };
}

async function oauthToken(row: typeof schema.credentials.$inferSelect, oauth?: OAuthConfig): Promise<string> {
  const blob = JSON.parse(decrypt(row.encrypted)) as OAuthBlob;
  const fresh = row.expiresAt && row.expiresAt.getTime() - Date.now() > 60_000;
  if (fresh || !blob.refreshToken) return blob.accessToken;
  if (!oauth) throw new Error(`provider has no oauth config to refresh credential ${row.id}`);

  const refreshed = await refreshAccessToken(oauth, blob.refreshToken);
  const next: OAuthBlob = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? blob.refreshToken,
  };
  await db
    .update(schema.credentials)
    .set({ encrypted: encrypt(JSON.stringify(next)), expiresAt: refreshed.expiresAt ?? null })
    .where(eq(schema.credentials.id, row.id));
  // update row in memory so a second call within this process sees the new expiry
  row.encrypted = encrypt(JSON.stringify(next));
  row.expiresAt = refreshed.expiresAt ?? null;
  return next.accessToken;
}
