import { db, encrypt, exchangeCode, getProvider, schema } from "@croft/core";

export async function storeOAuthCredential(providerId: string, pasted: string, verifier: string) {
  const provider = getProvider(providerId);
  if (!provider.oauth) throw new Error("provider has no oauth");
  const tokens = await exchangeCode(provider.oauth, pasted, verifier);
  await db.insert(schema.credentials).values({
    providerId,
    kind: "oauth",
    encrypted: encrypt(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })),
    expiresAt: tokens.expiresAt,
  });
}
