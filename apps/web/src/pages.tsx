import type { Child } from "hono/jsx";
import type { ActiveModel, Config, Learning, PreviewLogin, ProviderAdapter, RunStatus, schema } from "@croft/core";
import { LEARNING_CAP, LEARNING_MAX_CHARS } from "@croft/core";

type Run = typeof schema.runs.$inferSelect;
type CredentialRow = typeof schema.credentials.$inferSelect;

// DD/MM/YYYY HH:MM
function fmtDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

const NAV = [
  ["/runs", "Runs"],
  ["/new", "New run"],
  ["/models", "Models"],
  ["/chat", "Chat"],
  ["/learnings", "Learnings"],
  ["/export", "Export & clean up"],
  ["/settings", "Settings"],
];

export function Layout(props: { title: string; children: Child }) {
  return (
    <html>
      <head>
        <title>{props.title} — Croft</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <nav>
          <a class="brand" href="/runs">
            Croft
          </a>
          {NAV.map(([href, label]) => (
            <a href={href} class={label === props.title ? "active" : undefined}>
              {label}
            </a>
          ))}
          <a class="external" href="https://github.com/devlarabar/croft" target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </nav>
        <main>{props.children}</main>
      </body>
    </html>
  );
}

function StatusCell({ status }: { status: RunStatus }) {
  return <span class={`status-${status}`}>{status}</span>;
}

export function RunsPage({ runs }: { runs: Run[] }) {
  return (
    <Layout title="Runs">
      <div class="page-head">
        <h1>Runs</h1>
        <a class="btn" href="/new">
          New run
        </a>
      </div>
      <p class="sub">
        {runs.length} runs · {new Set(runs.map((run) => run.repo)).size} repos
      </p>
      <table class="runs-table">
        <tr>
          <th>Pull request</th>
          <th>Mode</th>
          <th>Status</th>
          <th>Timing</th>
          <th></th>
        </tr>
        {runs.map((run) => (
          <tr>
            <td>
              <a href={`https://github.com/${run.repo}/pull/${run.prNumber}`}>
                {run.repo}#{run.prNumber}
              </a>
              <div class="mono muted">{run.model}</div>
            </td>
            <td class="mono">{run.mode}</td>
            <td>
              <StatusCell status={run.status} />
              {run.error ? (
                <details>
                  <summary class="mono muted">error</summary>
                  <button
                    class="link copy"
                    onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent); this.textContent = '⎘ Copied'"
                  >
                    ⎘ Click to copy
                  </button>
                  <div class="mono muted">{run.error}</div>
                </details>
              ) : null}
            </td>
            <td class="mono">
              {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              {run.finishedAt ? ` → ${run.finishedAt.toISOString().slice(11, 16)}` : ""}
            </td>
            <td>
              <a href={`/runs/${run.id}`}>video</a>
              {run.status === "failed" || run.status === "error" || run.status === "partial" || run.status === "canceled" ? (
                <form method="post" action={`/runs/${run.id}/retry`} style="display:inline;margin-left:0.75rem">
                  <button class="link">retry</button>
                </form>
              ) : null}
              {run.status === "queued" || run.status === "starting" || run.status === "running" ? (
                <form method="post" action={`/runs/${run.id}/cancel`} style="display:inline;margin-left:0.75rem">
                  <button class="link">cancel</button>
                </form>
              ) : null}
            </td>
          </tr>
        ))}
      </table>
    </Layout>
  );
}

export function RunDetailPage({ run, videoUrl }: { run: Run; videoUrl: string }) {
  return (
    <Layout title={`Run ${run.id}`}>
      <h1>
        {run.repo}#{run.prNumber} — <StatusCell status={run.status} />
      </h1>
      <video controls src={videoUrl}></video>
    </Layout>
  );
}

export interface OpenPr {
  repo: string;
  number: number;
  title: string;
}

export function NewRunPage({ prs, error }: { prs: OpenPr[]; error?: string }) {
  return (
    <Layout title="New run">
      <h1>New run</h1>
      <p class="sub">Pick a pull request and Croft takes it from there.</p>
      {error ? <p style="color:#c04a5e">{error}</p> : null}
      {prs.length === 0 ? (
        <p>No open PRs across the allow-listed repos (configure repos in Settings).</p>
      ) : (
        <form method="post" action="/runs">
          <p>
            <label>
              Pull request<br />
              <select name="pr">
                {prs.map((pr) => (
                  <option value={`${pr.repo}#${pr.number}`}>
                    {pr.repo}#{pr.number} — {pr.title}
                  </option>
                ))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Mode<br />
              <select name="mode">
                <option value="test">test</option>
                <option value="review">review</option>
              </select>
            </label>
          </p>
          <p>
            <label>
              <input type="checkbox" name="freshPlan" /> Generate a fresh test plan from the diff
              (ignore any plan in the PR body)
            </label>
          </p>
          <p>
            <label>
              Preview URL override (optional — otherwise discovered from the PR's "preview deployment" comment)
              <br />
              <input name="previewUrl" type="url" size={60} />
            </label>
          </p>
          <button>Run</button>
        </form>
      )}
    </Layout>
  );
}

export function ModelsPage(props: {
  providers: ProviderAdapter[];
  creds: CredentialRow[];
  active: ActiveModel | null;
  notice?: string;
}) {
  return (
    <Layout title="Models">
      <h1>Models</h1>
      {props.notice ? <p>{props.notice}</p> : null}
      <fieldset>
        <legend>Active model</legend>
        <form method="post" action="/models/active">
          <select name="model">
            {props.providers.flatMap((provider) =>
              provider.models.map((model) => (
                <option
                  value={`${provider.id}/${model}`}
                  selected={props.active?.providerId === provider.id && props.active?.model === model}
                >
                  {provider.id} / {model}
                </option>
              )),
            )}
          </select>{" "}
          <select name="credentialId">
            {props.creds.map((cred) => (
              <option value={cred.id} selected={props.active?.credentialId === cred.id}>
                {cred.providerId} {cred.kind} ({cred.id.slice(0, 8)}) — {fmtDate(cred.createdAt)}
              </option>
            ))}
          </select>{" "}
          <button>Set active</button>
        </form>
      </fieldset>
      {props.providers.map((provider) => (
        <fieldset>
          <legend>{provider.id}</legend>
          <p>Models: {provider.models.join(", ")}</p>
          <form method="post" action="/models/credential">
            <input type="hidden" name="providerId" value={provider.id} />
            <input
              name="apiKey"
              type="password"
              placeholder={provider.id === "bedrock" ? "Access key ID" : "API key"}
              size={40}
            />{" "}
            {provider.id === "azure" ? (
              <input
                name="resourceName"
                placeholder="Resource name (the myname in myname.openai.azure.com)"
                size={46}
              />
            ) : null}
            {provider.id === "bedrock" ? (
              <>
                <input name="secretAccessKey" type="password" placeholder="Secret access key" size={40} />{" "}
                <input name="region" placeholder="Region" value="us-east-1" size={12} />
              </>
            ) : null}{" "}
            <button>Save credentials</button>
          </form>
          {provider.oauth ? (
            <p>
              <a href={`/oauth/start?provider=${provider.id}`}>Connect with OAuth</a>
            </p>
          ) : null}
        </fieldset>
      ))}
    </Layout>
  );
}

export function OAuthPastePage({ provider, authorizeUrl }: { provider: string; authorizeUrl: string }) {
  return (
    <Layout title="Connect OAuth">
      <h1>Connect {provider}</h1>
      <p>
        1. <a href={authorizeUrl} target="_blank">Authorize Croft</a> — the provider will show you a code.
      </p>
      <p>2. Paste the code here:</p>
      <form method="post" action="/oauth/paste">
        <input name="code" size={60} placeholder="code" />
        <button>Connect</button>
      </form>
    </Layout>
  );
}

export function ChatPage(props: { repo?: string; prNumber?: string; question?: string; answer?: string }) {
  return (
    <Layout title="Chat">
      <h1>Ask about a PR</h1>
      <p class="sub">Croft reads the diff and answers in place.</p>
      <form method="post" action="/chat">
        <p>
          <input name="repo" placeholder="owner/repo" value={props.repo} required />{" "}
          <input name="prNumber" type="number" placeholder="PR #" value={props.prNumber} required />
        </p>
        <p>
          <textarea name="question" rows={3} cols={70} required>
            {props.question}
          </textarea>
        </p>
        <button>Ask</button>
      </form>
      {props.answer ? <pre>{props.answer}</pre> : null}
    </Layout>
  );
}

export function LearningsPage({
  repos,
  learnings,
  notice,
}: {
  repos: string[];
  learnings: Learning[];
  notice?: string;
}) {
  return (
    <Layout title="Learnings">
      <h1>Learnings</h1>
      <p class="sub">
        Rules Croft applies when reviewing and answering questions about a repo. Max {LEARNING_MAX_CHARS}{" "}
        characters each, {LEARNING_CAP} per repo. Clear a row to delete it. Croft can add one himself: comment{" "}
        <code>@croft add-learning</code> on a PR or in a review thread.
      </p>
      {notice ? <p>{notice}</p> : null}
      <form method="post" action="/learnings">
        {repos.map((repo) => {
          const rows = learnings.filter((learning) => learning.repo === repo);
          return (
            <fieldset>
              <legend>
                {repo} ({rows.length}/{LEARNING_CAP})
              </legend>
              <table class="runs-table">
                <tr>
                  <th>Learning</th>
                  <th>Source</th>
                  <th>Added</th>
                </tr>
                {rows.map((learning) => (
                  <tr>
                    <td>
                      <input
                        name={`learning_${learning.id}`}
                        value={learning.text}
                        maxlength={LEARNING_MAX_CHARS}
                        size={80}
                      />
                    </td>
                    <td class="mono muted">
                      {learning.sourceUrl ? (
                        <a href={learning.sourceUrl}>{learning.author ?? "comment"}</a>
                      ) : (
                        "dashboard"
                      )}
                    </td>
                    <td class="mono muted">{fmtDate(learning.createdAt)}</td>
                  </tr>
                ))}
                {rows.length < LEARNING_CAP ? (
                  <tr>
                    <td>
                      <input
                        name={`new_${repo}`}
                        placeholder="Add a learning"
                        maxlength={LEARNING_MAX_CHARS}
                        size={80}
                      />
                    </td>
                    <td colspan={2}></td>
                  </tr>
                ) : null}
              </table>
            </fieldset>
          );
        })}
        {repos.length === 0 ? <p>Add a repo to the allow-list in Settings first.</p> : <button>Save</button>}
      </form>
    </Layout>
  );
}

export function ExportPage({ notice }: { notice?: string }) {
  return (
    <Layout title="Export & clean up">
      <h1>Export &amp; clean up</h1>
      {notice ? <p>{notice}</p> : null}
      <fieldset>
        <legend>Download zip</legend>
        <form method="get" action="/api/export">
          <label>
            Runs older than <input name="before" type="date" required />
          </label>{" "}
          <button>Download zip</button>
        </form>
        <p>Artifacts already removed by the 60-day storage lifecycle rule are skipped.</p>
      </fieldset>
      <fieldset>
        <legend>Delete data older than</legend>
        <form method="post" action="/api/purge">
          <label>
            Date <input name="before" type="date" required />
          </label>{" "}
          <label>
            Type <code>delete</code> to confirm <input name="confirm" required />
          </label>{" "}
          <button class="danger">Delete</button>
        </form>
      </fieldset>
    </Layout>
  );
}

export function SettingsPage({ cfg, notice }: { cfg: Config; notice?: string }) {
  return (
    <Layout title="Settings">
      <h1>Settings</h1>
      {notice ? <p>{notice}</p> : null}
      <form method="post" action="/settings">
        <fieldset>
          <legend>Triggers</legend>
          <label>
            <input type="checkbox" name="webhooksEnabled" checked={cfg.webhooksEnabled} /> Enable
            webhook-driven actions (comment triggers &amp; Q&amp;A)
          </label>
        </fieldset>
        <fieldset>
          <legend>Run limits</legend>
          <label>
            Tool-call budget cap per run{" "}
            <input type="number" name="toolCallCap" min={1} value={String(cfg.toolCallCap)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Findings ping (GitHub username mentioned in reviews to validate &amp; fix findings; blank disables)</legend>
          <input name="findingsPing" placeholder="username" value={cfg.findingsPing ?? undefined} />
        </fieldset>
        <fieldset>
          <legend>Repo allow-list (one owner/repo per line)</legend>
          <textarea name="repos" rows={4} cols={50}>
            {cfg.repos.join("\n")}
          </textarea>
        </fieldset>
        <fieldset>
          <legend>Auto-review (review every PR when opened or marked ready, drafts excluded)</legend>
          {cfg.repos.map((repo) => (
            <label style="display:block">
              <input type="checkbox" name={`autoreview_${repo}`} checked={cfg.autoReviewRepos.includes(repo)} />{" "}
              {repo}
            </label>
          ))}
          {cfg.repos.length === 0 ? <p>Add a repo to the allow-list and save to enable auto-review here.</p> : null}
        </fieldset>
        <fieldset>
          <legend>Allowed users (GitHub usernames who may trigger Croft via comments)</legend>
          <textarea name="allowedUsers" rows={3} cols={50}>
            {cfg.allowedUsers.join("\n")}
          </textarea>
        </fieldset>
        <fieldset>
          <legend>Preview login credentials (per repo, used by the agent if the preview asks to log in)</legend>
          {cfg.repos.map((repo) => {
            const logins: PreviewLogin[] = cfg.previewLogins[repo] ?? [];
            // One row per existing login plus a blank row for adding another;
            // clearing a row's username deletes that login on save.
            const rows: (PreviewLogin | undefined)[] = [...logins, undefined];
            return (
              <p>
                <strong>{repo}</strong>
                {rows.map((login, index) => (
                  <>
                    <br />
                    <input name={`login_label_${repo}_${index}`} placeholder="label (optional)" value={login?.label} />{" "}
                    <input name={`login_url_${repo}_${index}`} placeholder="login URL (optional)" size={40} value={login?.loginUrl} />{" "}
                    <input name={`login_user_${repo}_${index}`} placeholder="username" value={login?.username} />{" "}
                    <input
                      name={`login_pass_${repo}_${index}`}
                      type="password"
                      placeholder={login ? "(unchanged)" : "password"}
                    />
                  </>
                ))}
              </p>
            );
          })}
          <p>Add a repo to the allow-list and save to configure its logins here. Give accounts a label so test plans can name them.</p>
        </fieldset>
        <fieldset>
          <legend>Repo context (Markdown, given to the agent for runs in that repo)</legend>
          {cfg.repos.map((repo) => (
            <p>
              <strong>{repo}</strong>
              <br />
              <textarea name={`context_${repo}`} rows={6} cols={70}>
                {cfg.repoContext[repo] ?? ""}
              </textarea>
            </p>
          ))}
          <p>Add a repo to the allow-list and save to configure its context here.</p>
        </fieldset>
        <button>Save</button>
      </form>
      <p>
        GitHub App webhook URL is <code>/api/webhooks/github</code> on this host.
      </p>
    </Layout>
  );
}
