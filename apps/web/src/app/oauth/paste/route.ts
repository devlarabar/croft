import { getProvider, parseOAuthRedirect } from "@croft/core";
import { redirect, route } from "../../../http";
import { storeOAuthCredential } from "../../../oauth-credential";
import { clearOAuthState, getOAuthState } from "../../../session";

export const POST = route(async (request) => {
  const oauthState = getOAuthState(request);
  if (!oauthState) return new Response("oauth session expired — start again", { status: 400 });
  const form = await request.formData();
  const cfg = getProvider(oauthState.provider).oauth;
  const pasted = form.get("code");
  if (!cfg || typeof pasted !== "string") return new Response("Missing authorization code. Start again from Models.", { status: 400 });
  const code = cfg.redirectPaste ? parseOAuthRedirect(pasted, cfg, oauthState.state) : pasted.trim();
  if (!code) return new Response("Invalid callback. Paste the full URL from this login attempt, or start again from Models.", { status: 400 });
  try {
    await storeOAuthCredential(oauthState.provider, code, oauthState.verifier);
  } catch {
    console.error("OAuth credential connection failed", { providerId: oauthState.provider });
    return redirect("/models?notice=OAuth+connection+failed.+Please+connect+again.");
  }
  const response = redirect("/models?notice=OAuth+connected");
  clearOAuthState(response);
  return response;
});
