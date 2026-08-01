import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";

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

export function setSession(c: Context, username: string): void {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  setCookie(c, COOKIE, sign(JSON.stringify({ username, exp })), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
}

export function sessionUser(c: Context): string | null {
  const payload = verify(getCookie(c, COOKIE));
  if (!payload) return null;
  const { username, exp } = JSON.parse(payload) as { username: string; exp: number };
  return exp > Date.now() ? username : null;
}

// Short-lived signed cookie carrying OAuth state + PKCE verifier between
// /oauth/start and the callback/paste step. Also used for dashboard login.
export interface OAuthState {
  provider: string;
  state: string;
  verifier: string;
}

export function setOAuthState(c: Context, data: OAuthState): void {
  setCookie(c, OAUTH_COOKIE, sign(JSON.stringify({ ...data, exp: Date.now() + 10 * 60_000 })), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
}

export function getOAuthState(c: Context): OAuthState | null {
  const payload = verify(getCookie(c, OAUTH_COOKIE));
  if (!payload) return null;
  const data = JSON.parse(payload) as OAuthState & { exp: number };
  return data.exp > Date.now() ? data : null;
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

// GitHub OAuth login restricted to DASHBOARD_USER.
export async function requireAuth(c: Context, next: Next) {
  // Local dev only: skip GitHub login entirely.
  if (process.env.DEV_NO_AUTH === "1") return next();
  if (sessionUser(c)) return next();
  return c.redirect("/login");
}

export function githubLoginUrl(state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_OAUTH_CLIENT_ID!);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function githubExchange(code: string): Promise<string | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
    }),
  });
  const { access_token } = (await res.json()) as { access_token?: string };
  if (!access_token) return null;
  const userRes = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${access_token}`, "user-agent": "croft" },
  });
  const user = (await userRes.json()) as { login?: string };
  return user.login ?? null;
}
