import { db, schema, type DashboardRole } from "@croft/core";
import { eq } from "drizzle-orm";
import { UnavailablePage } from "./components/unavailable-page";
import { html } from "./html";
import { redirect } from "./http";
import { sessionUser } from "./session";
import { requestUrl } from "./request-url";

export function canAccess(role: DashboardRole, method: string, path: string): boolean {
  if (role === "admin") return true;
  if (role !== "member" || (method !== "GET" && method !== "HEAD")) return false;
  return path === "/" || path === "/runs" || /^\/runs\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?:\/video)?$/i.test(path);
}

export async function requireAuth(request: Request): Promise<DashboardRole | Response> {
  let role: DashboardRole = "user";
  if (process.env.DEV_NO_AUTH === "1") {
    role = "admin";
  } else {
    const githubId = sessionUser(request);
    if (!githubId) return redirect(new URL("/login", requestUrl(request)).href);
    const [user] = await db.select({ role: schema.dashboardUsers.role }).from(schema.dashboardUsers)
      .where(eq(schema.dashboardUsers.githubId, githubId));
    if (user) role = user.role;
  }
  if (!canAccess(role, request.method, new URL(request.url).pathname)) {
    return html(<UnavailablePage />, 403);
  }
  return role;
}
