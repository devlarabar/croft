import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

export const githubUserSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1) });
const sessionSchema = z.object({ githubId: z.string(), exp: z.number() });

const COOKIE = "croft_session";
const OAUTH_COOKIE = "croft_oauth";

function sign(payload: string): string {
  const mac = createHmac("sha256", process.env.TOKEN_ENC_KEY!).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const [b64, mac] = token.split(".");
  if (!b64 || !mac) return null;
  const payload = Buffer.from(b64, "base64url").toString();
  const expected = createHmac("sha256", process.env.TOKEN_ENC_KEY!).update(payload).digest("base64url");
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return payload;
}

export function setSession(ctx: Context, githubId: string): void {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  setCookie(ctx, COOKIE, sign(JSON.stringify({ githubId, exp })), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
}

export function sessionUser(ctx: Context): string | null {
  const payload = verify(getCookie(ctx, COOKIE));
  if (!payload) return null;
  const result = sessionSchema.safeParse(JSON.parse(payload));
  return result.success && result.data.exp > Date.now() ? result.data.githubId : null;
}

// Short-lived signed cookie carrying OAuth state + PKCE verifier between
// /oauth/start and the callback/paste step. Also used for dashboard login.
export interface OAuthState {
  provider: string;
  state: string;
  verifier: string;
}

export function setOAuthState(ctx: Context, data: OAuthState): void {
  setCookie(ctx, OAUTH_COOKIE, sign(JSON.stringify({ ...data, exp: Date.now() + 10 * 60_000 })), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
}

export function getOAuthState(ctx: Context): OAuthState | null {
  const payload = verify(getCookie(ctx, OAUTH_COOKIE));
  if (!payload) return null;
  const data = JSON.parse(payload) as OAuthState & { exp: number };
  return data.exp > Date.now() ? data : null;
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

export function githubLoginUrl(state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID!);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function githubExchange(code: string) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
    }),
  });
  if (!res.ok) return null;
  const token = z.object({ access_token: z.string() }).safeParse(await res.json());
  if (!token.success) return null;
  const userRes = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${token.data.access_token}`, "user-agent": "croft" },
  });
  if (!userRes.ok) return null;
  const user = githubUserSchema.safeParse(await userRes.json());
  return user.success ? user.data : null;
}
