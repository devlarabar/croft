import { db, schema, type DashboardRole } from "@croft/core";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { Layout } from "./layout.js";
import { sessionUser } from "./session.js";

export interface DashboardEnv {
  Variables: { role: DashboardRole };
}

export function canAccess(role: DashboardRole, method: string, path: string): boolean {
  if (role === "admin") return true;
  if (role !== "member" || (method !== "GET" && method !== "HEAD")) return false;
  return path === "/" || path === "/runs" || /^\/runs\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?:\/video)?$/i.test(path);
}

export const requireAuth = createMiddleware<DashboardEnv>(async (ctx, next) => {
  ctx.header("Cache-Control", "private, no-store");
  let role: DashboardRole = "user";
  if (process.env.DEV_NO_AUTH === "1") {
    role = "admin";
  } else {
    const githubId = sessionUser(ctx);
    if (!githubId) return ctx.redirect("/login");
    const [user] = await db.select({ role: schema.dashboardUsers.role }).from(schema.dashboardUsers)
      .where(eq(schema.dashboardUsers.githubId, githubId));
    if (user) role = user.role;
  }
  ctx.set("role", role);
  if (!canAccess(role, ctx.req.method, ctx.req.path)) {
    return ctx.html(
      <Layout title="Content unavailable" role="user">
        <h1>This content isn’t available</h1>
        <p>Contact an administrator to request access.</p>
      </Layout>,
      403,
    );
  }
  return next();
});
