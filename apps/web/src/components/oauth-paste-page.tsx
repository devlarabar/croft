import { Layout } from "../layout";
import { Button } from "./button";
interface OAuthPastePageProps {
  provider: string;
  authorizeUrl: string;
  redirectPaste?: boolean;
}

export function OAuthPastePage({ provider, authorizeUrl, redirectPaste }: OAuthPastePageProps) {
  return (
    <Layout title="Connect OAuth">
      <h1>Connect {provider}</h1>
      <p>
        1. <a href={authorizeUrl} target="_blank" rel="noreferrer">Authorize Croft</a>
        {redirectPaste ? " — sign in with your ChatGPT account." : " — the provider will show you a code."}
      </p>
      {redirectPaste ? <p>After signing in, you’ll be redirected to localhost:1455. The page may not load; copy its full URL from the address bar and return here. Close any running Codex login first.</p> : null}
      <p>2. {redirectPaste ? "Paste the full callback URL here:" : "Paste the code here:"}</p>
      <form method="post" action="/oauth/paste">
        <input name="code" aria-label={redirectPaste ? "Callback URL" : "Authorization code"} size={60} placeholder={redirectPaste ? "http://localhost:1455/auth/callback?..." : "code"} required autoComplete="off" />
        <Button>Connect</Button>
      </form>
    </Layout>
  );
}
