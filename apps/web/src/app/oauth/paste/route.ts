import { exchangeCode, getProvider } from "@croft/core";
import { redirect, route } from "../../../http";
import { oauthFailure, storeOAuthCredential } from "../../../oauth-credential";
import { clearOAuthState, getOAuthState } from "../../../session";

export const POST = route(async (request) => {
  const oauthState = getOAuthState(request);
  if (!oauthState) return new Response("oauth session expired — start again", { status: 400 });
  const form = await request.formData();
  const cfg = getProvider(oauthState.provider).oauth;
  const pasted = form.get("code");
  if (!cfg || cfg.flow === "device" || typeof pasted !== "string" || !pasted.trim()) {
    return new Response("Missing authorization code. Start again from Models.", { status: 400 });
  }
  try {
    await storeOAuthCredential(oauthState.provider, await exchangeCode(cfg, pasted, oauthState.verifier, request.signal));
  } catch (error) {
    return oauthFailure(oauthState.provider, error);
  }
  const response = redirect("/models?notice=OAuth+connected");
  clearOAuthState(response);
  return response;
});
