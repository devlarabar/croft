import { db, schema } from "@croft/core";
import { asc } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { Layout } from "./layout.js";
import { githubUserSchema } from "./session.js";

const grantSchema = z.object({
  username: z.string().trim().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i),
  role: z.enum(["user", "member", "admin"]),
});

export const users = new Hono();

users.get("/", async (ctx) => {
  const rows = await db.select().from(schema.dashboardUsers).orderBy(asc(schema.dashboardUsers.username));
  return ctx.html(
    <Layout title="Users">
      <h1>Users</h1>
      <p>User: no access. Member: view runs and videos. Admin: full access, including managing roles.</p>
      {ctx.req.query("saved") ? <p>Access updated.</p> : null}
      {ctx.req.query("error") ? <p>Could not update access. Check the GitHub username and try again. devlarabar must remain an admin.</p> : null}
      <table class="runs-table">
        <tr><th>GitHub username</th><th>Role</th></tr>
        {rows.map((user) => <tr><td>{user.username}</td><td>{user.role}</td></tr>)}
      </table>
      <h2>Set access</h2>
      <p>You can add someone before their first sign-in, or change an existing user’s role.</p>
      <form method="post" action="/users">
        <label>GitHub username <input name="username" required maxlength={39} /></label>{" "}
        <label>Role <select name="role">
          <option value="user">User</option>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select></label>{" "}
        <button>Save access</button>
      </form>
    </Layout>,
  );
});

users.post("/", async (ctx) => {
  const form = await ctx.req.formData();
  const grant = grantSchema.safeParse({ username: form.get("username"), role: form.get("role") });
  if (!grant.success) return ctx.redirect("/users?error=1");
  try {
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(grant.data.username)}`, {
      headers: { "user-agent": "croft", accept: "application/vnd.github+json" },
    });
    if (!response.ok) return ctx.redirect("/users?error=1");
    const user = githubUserSchema.parse(await response.json());
    await db.insert(schema.dashboardUsers).values({
      githubId: String(user.id), username: user.login, role: grant.data.role,
    }).onConflictDoUpdate({
      target: schema.dashboardUsers.githubId,
      set: { username: user.login, role: grant.data.role },
    });
    return ctx.redirect("/users?saved=1");
  } catch (error) {
    console.error("dashboard access update failed", error);
    return ctx.redirect("/users?error=1");
  }
});
