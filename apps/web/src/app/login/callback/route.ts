import { db, schema } from "@croft/core";
import { eq } from "drizzle-orm";
import { redirect, route, serverError } from "../../../http";
import { clearOAuthState, getOAuthState, githubExchange, setSession } from "../../../session";

export const GET = route(async (request) => {
  const query = new URL(request.url).searchParams;
  const oauthState = getOAuthState(request);
  if (!oauthState || oauthState.provider !== "github-login" || oauthState.state !== query.get("state")) {
    return new Response("bad oauth state", { status: 400 });
  }
  let response: Response;
  try {
    const user = await githubExchange(query.get("code") ?? "");
    if (!user) {
      response = new Response("GitHub sign-in failed. Please try signing in again.", { status: 401 });
    } else {
      const githubId = String(user.id);
      // The owner's default-role insert fails its CHECK before ON CONFLICT can update it.
      const updated = await db.update(schema.dashboardUsers).set({ username: user.login })
        .where(eq(schema.dashboardUsers.githubId, githubId)).returning({ githubId: schema.dashboardUsers.githubId });
      if (updated.length === 0) {
        await db.insert(schema.dashboardUsers).values({ githubId, username: user.login })
          .onConflictDoUpdate({ target: schema.dashboardUsers.githubId, set: { username: user.login } });
      }
      response = redirect("/runs");
      setSession(response, githubId);
    }
  } catch (error) {
    response = serverError(error);
  }
  clearOAuthState(response);
  return response;
});
