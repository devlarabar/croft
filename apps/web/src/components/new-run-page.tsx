import { Play } from "lucide-react";
import { Layout } from "../layout";
import type { OpenPr } from "../data/open-prs";
import { Button } from "./button";
import { Card } from "./card";
import { PageHeader } from "./page-header";

interface NewRunPageProps {
  prs: OpenPr[];
  error?: string;
}

export function NewRunPage({ prs, error }: NewRunPageProps) {
  return (
    <Layout title="New run">
      <PageHeader title="New run" description="Pick a pull request and Croft takes it from there." />
      {error ? <p className="text-error" role="alert">{error}</p> : null}
      {prs.length === 0 ? (
        <p>No open PRs across the allow-listed repos (configure repos in <a href="/settings">Settings</a>).</p>
      ) : (
        <Card>
          <form method="post" action="/runs" className="flex flex-col gap-5">
            <label>Pull request
              <select name="pr">
                {prs.map((pr) => <option key={`${pr.repo}#${pr.number}`} value={`${pr.repo}#${pr.number}`}>{pr.repo}#{pr.number} — {pr.title}</option>)}
              </select>
            </label>
            <label className="max-w-50">Mode
              <select name="mode"><option value="test">test</option><option value="review">review</option></select>
            </label>
            <label><input type="checkbox" name="freshPlan" /><span>Generate a fresh test plan from the diff (ignore any plan in the PR body)</span></label>
            <label>Preview URL override
              <input name="previewUrl" type="url" placeholder="https://preview.example.com" aria-describedby="preview-hint" />
              <span id="preview-hint" className="caption muted">Optional — otherwise discovered from the PR's "preview deployment" comment.</span>
            </label>
            <div className="form-row">
              <Button><Play size={16} aria-hidden="true" />Run</Button>
              <span className="caption muted">Croft posts the result back on the PR when it finishes.</span>
            </div>
          </form>
        </Card>
      )}
    </Layout>
  );
}
