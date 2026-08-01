import { createHash, randomBytes } from "node:crypto";
import type { OAuthConfig } from "./types.js";

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function generatePkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(cfg: OAuthConfig, challenge: string, state: string): string {
  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", cfg.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (cfg.codePaste) url.searchParams.set("code", "true");
  return url.toString();
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

async function tokenRequest(tokenUrl: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
  };
}

// Code-paste flows return "code#state" from the provider's callback page.
export function exchangeCode(cfg: OAuthConfig, pasted: string, verifier: string): Promise<TokenResponse> {
  const [code, state] = pasted.trim().split("#");
  return tokenRequest(cfg.tokenUrl, {
    grant_type: "authorization_code",
    code: code!,
    ...(state ? { state } : {}),
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
  });
}

export function refreshAccessToken(cfg: OAuthConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(cfg.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
}
