import { redirect, route } from "../../http";
import { githubLoginUrl, newState, setOAuthState } from "../../session";

export const GET = route(() => {
  const state = newState();
  const response = redirect(githubLoginUrl(state));
  setOAuthState(response, { provider: "github-login", state, verifier: "" });
  return response;
});
