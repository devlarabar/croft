import type { Child } from "hono/jsx";
import type { ActiveModel, Config, PreviewLogin, ProviderAdapter, RunStatus, schema } from "@croft/core";

type Run = typeof schema.runs.$inferSelect;
type CredentialRow = typeof schema.credentials.$inferSelect;

const CSS = `
body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; }
nav { background: #14532d; padding: 0.6rem 1rem; }
nav a { color: #ecfdf5; margin-right: 1rem; text-decoration: none; font-weight: 500; }
main { max-width: 60rem; margin: 1.5rem auto; padding: 0 1rem; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }
input, select, textarea, button { font: inherit; padding: 0.35rem 0.5rem; margin: 0.15rem 0; }
button { cursor: pointer; background: #14532d; color: white; border: none; border-radius: 4px; padding: 0.45rem 0.9rem; }
button.danger { background: #991b1b; }
fieldset { border: 1px solid #ccc; border-radius: 6px; margin-bottom: 1rem; }
.status-passed { color: #15803d; } .status-failed, .status-error { color: #b91c1c; }
.status-running, .status-starting, .status-queued { color: #b45309; } .status-cap_hit { color: #7c3aed; }
video { max-width: 100%; }
pre { background: #f5f5f5; padding: 0.8rem; overflow-x: auto; white-space: pre-wrap; }
`;

export function Layout(props: { title: string; children: Child }) {
  return (
    <html>
      <head>
        <title>{props.title} — Croft</title>
        <style>{CSS}</style>
      </head>
      <body>
        <nav>
          <a href="/runs">Runs</a>
          <a href="/new">New run</a>
          <a href="/models">Models</a>
          <a href="/chat">Chat</a>
          <a href="/export">Export &amp; clean up</a>
          <a href="/settings">Settings</a>
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
      <h1>Runs</h1>
      <table>
        <tr>
          <th>PR</th>
          <th>Mode</th>
          <th>Status</th>
          <th>Model</th>
          <th>Created</th>
          <th>Finished</th>
          <th></th>
        </tr>
        {runs.map((r) => (
          <tr>
            <td>
              <a href={`https://github.com/${r.repo}/pull/${r.prNumber}`}>
                {r.repo}#{r.prNumber}
              </a>
            </td>
            <td>{r.mode}</td>
            <td>
              <StatusCell status={r.status} />
              {r.error ? ` — ${r.error}` : ""}
            </td>
            <td>{r.model}</td>
            <td>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
            <td>{r.finishedAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""}</td>
            <td>
              <a href={`/runs/${r.id}`}>video</a>
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
      {error ? <p style="color:#b91c1c">{error}</p> : null}
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
              </select>
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
            {props.providers.flatMap((p) =>
              p.models.map((m) => (
                <option
                  value={`${p.id}/${m}`}
                  selected={props.active?.providerId === p.id && props.active?.model === m}
                >
                  {p.id} / {m}
                </option>
              )),
            )}
          </select>{" "}
          <select name="credentialId">
            {props.creds.map((c) => (
              <option value={c.id} selected={props.active?.credentialId === c.id}>
                {c.providerId} {c.kind} ({c.id.slice(0, 8)})
              </option>
            ))}
          </select>{" "}
          <button>Set active</button>
        </form>
      </fieldset>
      {props.providers.map((p) => (
        <fieldset>
          <legend>{p.id}</legend>
          <p>Models: {p.models.join(", ")}</p>
          <form method="post" action="/models/credential">
            <input type="hidden" name="providerId" value={p.id} />
            <input name="apiKey" type="password" placeholder="API key" size={40} />{" "}
            <button>Save API key</button>
          </form>
          {p.oauth ? (
            <p>
              <a href={`/oauth/start?provider=${p.id}`}>Connect with OAuth</a>
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
      <h1>Ask Croft about a PR</h1>
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
          <legend>Repo allow-list (one owner/repo per line)</legend>
          <textarea name="repos" rows={4} cols={50}>
            {cfg.repos.join("\n")}
          </textarea>
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
            const l: PreviewLogin | undefined = cfg.previewLogins[repo];
            return (
              <p>
                <strong>{repo}</strong>
                <br />
                <input name={`login_url_${repo}`} placeholder="login URL (optional)" size={40} value={l?.loginUrl} />{" "}
                <input name={`login_user_${repo}`} placeholder="username" value={l?.username} />{" "}
                <input
                  name={`login_pass_${repo}`}
                  type="password"
                  placeholder={l ? "(unchanged)" : "password"}
                />
              </p>
            );
          })}
          <p>Add a repo to the allow-list and save to configure its login here.</p>
        </fieldset>
        <button>Save</button>
      </form>
      <p>
        GitHub App webhook URL is <code>/api/webhooks/github</code> on this host.
      </p>
    </Layout>
  );
}
