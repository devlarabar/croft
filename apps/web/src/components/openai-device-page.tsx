import { Layout } from "../layout";
import { Button } from "./button";
import { Notice } from "./notice";

interface OpenAiDevicePageProps {
  userCode: string;
  pending?: boolean;
}

export function OpenAiDevicePage({ userCode, pending }: OpenAiDevicePageProps) {
  return (
    <Layout title="Connect OpenAI">
      <h1>Connect your ChatGPT account</h1>
      <p>Enable device code login in your ChatGPT security settings, or ask your workspace admin to enable it.</p>
      <p>Open <a href="https://auth.openai.com/codex/device" target="_blank" rel="noreferrer">OpenAI’s device login</a> and enter this code:</p>
      <p><strong>{userCode}</strong></p>
      <p>Only approve this code if you started this connection in Croft. It expires after 15 minutes.</p>
      <Notice>{pending ? "Approval is not confirmed yet. Finish signing in with OpenAI, wait a few seconds, then check again." : undefined}</Notice>
      <form method="post" action="/oauth/openai">
        <Button>Check connection</Button>
      </form>
      <p><a href="/oauth/openai">Start again</a> or <a href="/models">return to Models</a>.</p>
    </Layout>
  );
}
