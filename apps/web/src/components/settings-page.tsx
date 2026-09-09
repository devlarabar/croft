import type { Config } from "@croft/core";
import { Save } from "lucide-react";
import { Layout } from "../layout";
import { Button } from "./button";
import { Fieldset } from "./fieldset";
import { PreviewLogins } from "./preview-logins";
import { PageHeader } from "./page-header";
import { Notice } from "./notice";

interface SettingsPageProps {
  cfg: Config;
  notice?: string;
}

export function SettingsPage({ cfg, notice }: SettingsPageProps) {
  return (
    <Layout title="Settings">
      <PageHeader title="Settings" description="How Croft is triggered, what it may touch, and what it knows about each repo." />
      <Notice>{notice}</Notice>
      <form method="post" action="/settings">
        <Fieldset legend="Triggers">
          <label><input type="checkbox" name="webhooksEnabled" defaultChecked={cfg.webhooksEnabled} />Enable webhook-driven actions (comment triggers &amp; Q&amp;A)</label>
        </Fieldset>
        <Fieldset legend="Run limits">
          <label>Tool-call budget cap per run<input type="number" name="toolCallCap" min={1} defaultValue={String(cfg.toolCallCap)} /></label>
        </Fieldset>
        <Fieldset legend="Findings ping" description="Mentioned in reviews to validate and fix findings.">
          <label className="max-w-65">GitHub username<input name="findingsPing" placeholder="Optional" defaultValue={cfg.findingsPing ?? undefined} /></label>
          <label><input type="checkbox" name="findingsPingAuthor" defaultChecked={cfg.findingsPingAuthor} />Ping the PR author instead</label>
          <label><input type="checkbox" name="agentFixContext" defaultChecked={cfg.agentFixContext} />Include an agent-tuned fix brief per finding (extra tokens per review)</label>
        </Fieldset>
        <Fieldset legend="Repo allow-list">
          <textarea aria-label="Repo allow-list" aria-describedby="repos-hint" className="max-w-115" name="repos" rows={4} defaultValue={cfg.repos.join("\n")} />
          <p id="repos-hint" className="caption">One owner/repo per line.</p>
          <div className="repo-section">
            <h2 className="section-label">Auto-review</h2>
            <p className="caption">Review every PR when opened or marked ready. Drafts excluded.</p>
            {cfg.repos.map((repo) => <label key={repo}><input type="checkbox" name={`autoreview_${repo}`} defaultChecked={cfg.autoReviewRepos.includes(repo)} />{repo}</label>)}
            {cfg.repos.length === 0 ? <p>Add a repo to the allow-list and save to enable auto-review here.</p> : null}
          </div>
        </Fieldset>
        <Fieldset legend="Allowed users" description="GitHub usernames who may trigger Croft via comments.">
          <textarea aria-label="Allowed users" className="max-w-115" name="allowedUsers" rows={4} defaultValue={cfg.allowedUsers.join("\n")} />
        </Fieldset>
        <Fieldset legend="Preview login credentials" description="Per repo, used by the agent if the preview asks to log in. Give accounts a label so test plans can name them.">
          {cfg.repos.map((repo) => <PreviewLogins key={repo} repo={repo} logins={cfg.previewLogins[repo] ?? []} />)}
          {cfg.repos.length === 0 ? <p>Add a repo to the allow-list and save to configure its logins here.</p> : null}
        </Fieldset>
        <Fieldset legend="Repo context" description="Markdown, given to the agent for runs in that repo.">
          {cfg.repos.map((repo) => (
            <div className="repo-section" key={repo}>
              <label><strong>{repo}</strong><textarea name={`context_${repo}`} rows={6} placeholder="Anything the agent should know before it starts." defaultValue={cfg.repoContext[repo] ?? ""} /></label>
            </div>
          ))}
          {cfg.repos.length === 0 ? <p>Add a repo to the allow-list and save to configure its context here.</p> : null}
        </Fieldset>
        <div className="form-row"><Button><Save size={16} aria-hidden="true" />Save</Button><span className="caption muted">GitHub App webhook URL is /api/webhooks/github on this host.</span></div>
      </form>
    </Layout>
  );
}
