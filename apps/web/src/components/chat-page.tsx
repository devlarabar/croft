import { Layout } from "../layout";
import { Button } from "./button";

export interface ChatPageProps {
  repo?: string;
  prNumber?: string;
  question?: string;
  answer?: string;
}

export function ChatPage(props: ChatPageProps) {
  return (
    <Layout title="Chat">
      <h1>Ask about a PR</h1>
      <p className="sub">Croft reads the diff and answers in place.</p>
      <form method="post" action="/chat">
        <p>
          <input name="repo" placeholder="owner/repo" defaultValue={props.repo} required />{" "}
          <input name="prNumber" type="number" placeholder="PR #" defaultValue={props.prNumber} required />
        </p>
        <p>
          <textarea name="question" rows={3} cols={70} required defaultValue={props.question} />
        </p>
        <Button>Ask</Button>
      </form>
      {props.answer ? <pre>{props.answer}</pre> : null}
    </Layout>
  );
}
