import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "./access";
import { isCsrfRequest } from "./csrf";
import { runPageSchema } from "./run-pagination";
import { serverError } from "./http";

const GET_PATHS = new Set(["/", "/runs", "/new", "/models", "/chat", "/learnings", "/export", "/settings", "/users",
  "/credcheck", "/keyfp", "/oauth/start", "/oauth/callback", "/api/export", "/api/docs", "/api/openapi.json"]);
const FORM_PATHS = new Set(["/runs", "/chat", "/learnings", "/settings", "/users"]);
const POST_PATHS = new Set(["/models/credential", "/models/active", "/oauth/paste", "/api/purge"]);
const PUBLIC_GET_PATHS = new Set(["/login", "/login/callback", "/api/v1/activity", "/favicon.ico", "/styles.css"]);

export async function proxy(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname;
  const read = request.method === "GET" || request.method === "HEAD";
  if ((read && PUBLIC_GET_PATHS.has(path)) || (request.method === "POST" && (
    path === "/api/webhooks/github" || (path === "/api/local-runs" && process.env.DEV_NO_AUTH === "1")
  ))) return NextResponse.next();

  let response: Response;
  try {
    const role = await requireAuth(request);
    if (role instanceof Response) {
      response = role;
    } else if (isCsrfRequest(request)) {
      response = new Response("Forbidden", { status: 403 });
    } else if (read && path === "/runs" && !runPageSchema.safeParse(request.nextUrl.searchParams.get("page") ?? "1").success) {
      response = new Response("invalid page", { status: 400 });
    } else {
      const headers = new Headers(request.headers);
      headers.set("x-croft-role", role);
      if (request.method === "POST" && FORM_PATHS.has(path)) {
        const target = request.nextUrl.clone();
        target.pathname = `/api/forms${path}`;
        response = NextResponse.rewrite(target, { request: { headers } });
      } else if ((read && (GET_PATHS.has(path) || /^\/runs\/[^/]+(?:\/video)?$/.test(path)))
        || (request.method === "POST" && (POST_PATHS.has(path) || /^\/runs\/[^/]+\/(retry|cancel)$/.test(path)))) {
        response = NextResponse.next({ request: { headers } });
      } else {
        response = new Response("404 Not Found", { status: 404 });
      }
    }
  } catch (error) {
    response = serverError(error);
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/).*)"] };
