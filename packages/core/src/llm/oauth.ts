import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
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

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
});

async function tokenRequest(cfg: OAuthConfig, body: Record<string, string>): Promise<TokenResponse> {
  const form = cfg.tokenEncoding === "form";
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? new URLSearchParams(body) : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OAuth token endpoint returned ${res.status}. Reconnect from Models.`);
  const json = tokenResponseSchema.parse(await res.json());
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
  };
}

export function parseOAuthRedirect(pasted: string, cfg: OAuthConfig, state: string): string | null {
  if (!URL.canParse(pasted.trim())) return null;
  const url = new URL(pasted.trim());
  const redirect = new URL(cfg.redirectUri);
  if (url.origin !== redirect.origin || url.pathname !== redirect.pathname ||
      url.searchParams.get("state") !== state || url.searchParams.has("error")) return null;
  return url.searchParams.get("code") || null;
}

// Code-paste flows return "code#state" from the provider's callback page.
export function exchangeCode(cfg: OAuthConfig, pasted: string, verifier: string): Promise<TokenResponse> {
  const [code, state] = pasted.trim().split("#");
  return tokenRequest(cfg, {
    grant_type: "authorization_code",
    code: code!,
    ...(state ? { state } : {}),
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
  });
}

export function refreshAccessToken(cfg: OAuthConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(cfg, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  });
}
