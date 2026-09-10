import { db, encrypt, OAuthRequestError, schema, type TokenResponse } from "@croft/core";
import { redirect } from "./http";

export async function storeOAuthCredential(providerId: string, tokens: TokenResponse) {
  await db.insert(schema.credentials).values({
    providerId,
    kind: "oauth",
    encrypted: encrypt(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })),
    expiresAt: tokens.expiresAt,
  });
}

export function oauthFailure(providerId: string, error: unknown): Response {
  console.error("OAuth connection failed", {
    providerId,
    ...(error instanceof OAuthRequestError ? { step: error.step, status: error.status } : {}),
  });
  return redirect("/models?notice=OAuth+connection+failed.+Please+connect+again.");
}
