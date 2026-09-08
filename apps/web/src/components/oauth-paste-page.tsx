import { Layout } from "../layout";
import { Button } from "./button";
interface OAuthPastePageProps {
  provider: string;
  authorizeUrl: string;
}

export function OAuthPastePage({ provider, authorizeUrl }: OAuthPastePageProps) {
  return (
    <Layout title="Connect OAuth">
      <h1>Connect {provider}</h1>
      <p>
        1. <a href={authorizeUrl} target="_blank">Authorize Croft</a> — the provider will show you a code.
      </p>
      <p>2. Paste the code here:</p>
      <form method="post" action="/oauth/paste">
        <input name="code" size={60} placeholder="code" />
        <Button>Connect</Button>
      </form>
    </Layout>
  );
}
