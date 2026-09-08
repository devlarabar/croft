import type { Config } from "@croft/core";
import { Layout } from "../layout";
import { Button } from "./button";
import { Fieldset } from "./fieldset";
import { PreviewLogins } from "./preview-logins";

interface SettingsPageProps {
  cfg: Config;
  notice?: string;
}

export function SettingsPage({ cfg, notice }: SettingsPageProps) {
  return (
    <Layout title="Settings">
      <h1>Settings</h1>
      {notice ? <p>{notice}</p> : null}
      <form method="post" action="/settings">
        <Fieldset legend="Triggers">
          <label>
            <input type="checkbox" name="webhooksEnabled" defaultChecked={cfg.webhooksEnabled} /> Enable
            webhook-driven actions (comment triggers &amp; Q&amp;A)
          </label>
        </Fieldset>
        <Fieldset legend="Run limits">
          <label>
            Tool-call budget cap per run{" "}
            <input type="number" name="toolCallCap" min={1} defaultValue={String(cfg.toolCallCap)} />
          </label>
        </Fieldset>
        <Fieldset legend="Findings ping (mentioned in reviews to validate & fix findings)">
          <input name="findingsPing" placeholder="GitHub username (optional)" defaultValue={cfg.findingsPing ?? undefined} />
          <label className="block">
            <input type="checkbox" name="findingsPingAuthor" defaultChecked={cfg.findingsPingAuthor} /> Ping the PR
            author instead
          </label>
          <label className="block">
            <input type="checkbox" name="agentFixContext" defaultChecked={cfg.agentFixContext} /> Include an
            agent-tuned fix brief per finding (extra tokens per review)
          </label>
        </Fieldset>
        <Fieldset legend="Repo allow-list (one owner/repo per line)">
          <textarea name="repos" rows={4} cols={50} defaultValue={cfg.repos.join("\n")} />
        </Fieldset>
        <Fieldset legend="Auto-review (review every PR when opened or marked ready, drafts excluded)">
          {cfg.repos.map((repo) => (
            <label key={repo} className="block">
              <input type="checkbox" name={`autoreview_${repo}`} defaultChecked={cfg.autoReviewRepos.includes(repo)} />{" "}
              {repo}
            </label>
          ))}
          {cfg.repos.length === 0 ? <p>Add a repo to the allow-list and save to enable auto-review here.</p> : null}
        </Fieldset>
        <Fieldset legend="Allowed users (GitHub usernames who may trigger Croft via comments)">
          <textarea name="allowedUsers" rows={3} cols={50} defaultValue={cfg.allowedUsers.join("\n")} />
        </Fieldset>
        <Fieldset legend="Preview login credentials (per repo, used by the agent if the preview asks to log in)">
          {cfg.repos.map((repo) => <PreviewLogins key={repo} repo={repo} logins={cfg.previewLogins[repo] ?? []} />)}
          <p>Add a repo to the allow-list and save to configure its logins here. Give accounts a label so test plans can name them.</p>
        </Fieldset>
        <Fieldset legend="Repo context (Markdown, given to the agent for runs in that repo)">
          {cfg.repos.map((repo) => (
            <p key={repo}>
              <strong>{repo}</strong>
              <br />
              <textarea name={`context_${repo}`} rows={6} cols={70} defaultValue={cfg.repoContext[repo] ?? ""} />
            </p>
          ))}
          <p>Add a repo to the allow-list and save to configure its context here.</p>
        </Fieldset>
        <Button>Save</Button>
      </form>
      <p>GitHub App webhook URL is <code>/api/webhooks/github</code> on this host.</p>
    </Layout>
  );
}
