import { redirect, route } from "../../../http";
import { storeOAuthCredential } from "../../../oauth-credential";
import { getOAuthState } from "../../../session";

export const GET = route(async (request) => {
  const query = new URL(request.url).searchParams;
  const oauthState = getOAuthState(request);
  if (!oauthState || oauthState.state !== query.get("state")) return new Response("bad oauth state", { status: 400 });
  await storeOAuthCredential(oauthState.provider, query.get("code") ?? "", oauthState.verifier);
  return redirect("/models?notice=OAuth+connected");
});
