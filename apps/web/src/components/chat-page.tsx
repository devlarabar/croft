import { MessageSquare } from "lucide-react";
import { Layout } from "../layout";
import { Button } from "./button";
import { Card } from "./card";
import { PageHeader } from "./page-header";

export interface ChatPageProps {
  repo?: string;
  prNumber?: string;
  question?: string;
  answer?: string;
}

export function ChatPage(props: ChatPageProps) {
  return (
    <Layout title="Ask about a PR">
      <PageHeader title="Ask about a PR" description="Croft reads the diff and answers in place." />
      <Card>
        <form method="post" action="/chat" className="flex flex-col gap-5">
          <div className="form-row">
            <label>Repository<input name="repo" placeholder="owner/repo" defaultValue={props.repo} required /></label>
            <label>Pull request<input className="max-w-35" name="prNumber" type="number" min={1} placeholder="PR #" defaultValue={props.prNumber} required /></label>
          </div>
          <label>Question<textarea name="question" rows={5} placeholder="Does this PR change how the note template is resolved?" required defaultValue={props.question} /></label>
          <div className="form-row"><Button><MessageSquare size={16} aria-hidden="true" />Ask</Button><span className="caption muted">The answer appears below.</span></div>
        </form>
      </Card>
      {props.answer ? <pre>{props.answer}</pre> : null}
    </Layout>
  );
}
