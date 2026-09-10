import { authorizeUrl, generatePkce, getProvider } from "@croft/core";
import { OAuthPastePage } from "../../../components/oauth-paste-page";
import { html } from "../../../html";
import { redirect, route } from "../../../http";
import { newState, setOAuthState } from "../../../session";

export const GET = route(async (request) => {
  const provider = getProvider(new URL(request.url).searchParams.get("provider") ?? "");
  if (!provider.oauth) return new Response("provider has no oauth", { status: 400 });
  const pkce = generatePkce();
  // Anthropic requires the PKCE verifier as state, matching Claude Code's flow.
  const state = provider.oauth.codePaste ? pkce.verifier : newState();
  const url = authorizeUrl(provider.oauth, pkce.challenge, state);
  const response = provider.oauth.codePaste || provider.oauth.redirectPaste
    ? await html(<OAuthPastePage provider={provider.id} authorizeUrl={url} redirectPaste={provider.oauth.redirectPaste} />)
    : redirect(url);
  setOAuthState(response, { provider: provider.id, state, verifier: pkce.verifier });
  return response;
});
