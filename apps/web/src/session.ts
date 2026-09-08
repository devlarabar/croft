import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parse, serialize } from "cookie";
import { z } from "zod";

export const githubUserSchema = z.object({ id: z.number().int().positive(), login: z.string().min(1) });
const sessionSchema = z.object({ githubId: z.string(), exp: z.number() });
const oauthStateSchema = z.object({ provider: z.string(), state: z.string(), verifier: z.string(), exp: z.number() });

const COOKIE = "croft_session";
const OAUTH_COOKIE = "croft_oauth";
const cookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } satisfies Parameters<typeof serialize>[2];

function signature(payload: string): string {
  return createHmac("sha256", z.string().parse(process.env.TOKEN_ENC_KEY)).update(payload).digest("base64url");
}

function sign(payload: string): string {
  return `${Buffer.from(payload).toString("base64url")}.${signature(payload)}`;
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const [encoded, mac] = token.split(".");
  if (!encoded || !mac) return null;
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = signature(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return payload;
}

export function setSession(response: Response, githubId: string): void {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  response.headers.append("Set-Cookie", serialize(COOKIE, sign(JSON.stringify({ githubId, exp })), {
    ...cookieOptions, maxAge: 30 * 24 * 3600,
  }));
}

export function sessionUser(request: Request): string | null {
  const payload = verify(parse(request.headers.get("cookie") ?? "")[COOKIE]);
  if (!payload) return null;
  const result = sessionSchema.safeParse(JSON.parse(payload));
  return result.success && result.data.exp > Date.now() ? result.data.githubId : null;
}

export interface OAuthState {
  provider: string;
  state: string;
  verifier: string;
}

export function setOAuthState(response: Response, data: OAuthState): void {
  response.headers.append("Set-Cookie", serialize(OAUTH_COOKIE, sign(JSON.stringify({ ...data, exp: Date.now() + 10 * 60_000 })), {
    ...cookieOptions, maxAge: 600,
  }));
}

export function clearOAuthState(response: Response): void {
  response.headers.append("Set-Cookie", serialize(OAUTH_COOKIE, "", { path: "/", maxAge: 0 }));
}

export function getOAuthState(request: Request): OAuthState | null {
  const payload = verify(parse(request.headers.get("cookie") ?? "")[OAUTH_COOKIE]);
  if (!payload) return null;
  const data = oauthStateSchema.parse(JSON.parse(payload));
  return data.exp > Date.now() ? data : null;
}

export function newState(): string {
  return randomBytes(16).toString("base64url");
}

export function githubLoginUrl(state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", z.string().parse(process.env.GITHUB_OAUTH_CLIENT_ID));
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
