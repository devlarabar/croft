import { db, schema } from "@croft/core";
import { z } from "zod";
import { redirect, route } from "../../../../http";
import { githubUserSchema } from "../../../../session";

const grantSchema = z.object({
  username: z.string().trim().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i),
  role: z.enum(["user", "member", "admin"]),
});

export const POST = route(async (request) => {
  const form = await request.formData();
  const grant = grantSchema.safeParse({ username: form.get("username"), role: form.get("role") });
  if (!grant.success) return redirect("/users?error=1");
  try {
    const response = await fetch(`https://api.github.com/users/${encodeURIComponent(grant.data.username)}`, {
      headers: { "user-agent": "croft", accept: "application/vnd.github+json" },
    });
    if (!response.ok) return redirect("/users?error=1");
    const user = githubUserSchema.parse(await response.json());
    await db.insert(schema.dashboardUsers).values({
      githubId: String(user.id), username: user.login, role: grant.data.role,
    }).onConflictDoUpdate({
      target: schema.dashboardUsers.githubId,
      set: { username: user.login, role: grant.data.role },
    });
    return redirect("/users?saved=1");
  } catch (error) {
    console.error("dashboard access update failed", error);
    return redirect("/users?error=1");
  }
});
