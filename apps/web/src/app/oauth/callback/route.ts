import { exchangeCode, getProvider } from "@croft/core";
import { redirect, route } from "../../../http";
import { storeOAuthCredential } from "../../../oauth-credential";
import { getOAuthState } from "../../../session";

export const GET = route(async (request) => {
  const query = new URL(request.url).searchParams;
  const oauthState = getOAuthState(request);
  if (!oauthState || oauthState.state !== query.get("state")) return new Response("bad oauth state", { status: 400 });
  const cfg = getProvider(oauthState.provider).oauth;
  if (!cfg || cfg.flow === "device") return new Response("invalid oauth flow", { status: 400 });
  await storeOAuthCredential(oauthState.provider, await exchangeCode(cfg, query.get("code") ?? "", oauthState.verifier, request.signal));
  return redirect("/models?notice=OAuth+connected");
});
