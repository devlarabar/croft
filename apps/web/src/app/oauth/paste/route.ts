import { redirect, route } from "../../../http";
import { storeOAuthCredential } from "../../../oauth-credential";
import { getOAuthState } from "../../../session";

export const POST = route(async (request) => {
  const oauthState = getOAuthState(request);
  if (!oauthState) return new Response("oauth session expired — start again", { status: 400 });
  const form = await request.formData();
  await storeOAuthCredential(oauthState.provider, String(form.get("code")), oauthState.verifier);
  return redirect("/models?notice=OAuth+connected");
});
