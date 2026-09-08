import { Layout } from "../layout";
import type { OpenPr } from "../data/open-prs";
import { Button } from "./button";

interface NewRunPageProps {
  prs: OpenPr[];
  error?: string;
}

export function NewRunPage({ prs, error }: NewRunPageProps) {
  return (
    <Layout title="New run">
      <h1>New run</h1>
      <p className="sub">Pick a pull request and Croft takes it from there.</p>
      {error ? <p className="text-error">{error}</p> : null}
      {prs.length === 0 ? (
        <p>No open PRs across the allow-listed repos (configure repos in Settings).</p>
      ) : (
        <form method="post" action="/runs">
          <p>
            <label>
              Pull request<br />
              <select name="pr">
                {prs.map((pr) => (
                  <option key={`${pr.repo}#${pr.number}`} value={`${pr.repo}#${pr.number}`}>
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
          <Button>Run</Button>
        </form>
      )}
    </Layout>
  );
}
