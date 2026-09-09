import { Layout } from "../layout";
import type { Learning } from "@croft/core";
import { LEARNING_CAP, LEARNING_MAX_CHARS } from "@croft/core";
import { fmtDate } from "../format-date";
import { DataTable } from "./data-table";
import { Fieldset } from "./fieldset";
import { Button } from "./button";
import { Save } from "lucide-react";
import { PageHeader } from "./page-header";
import { Notice } from "./notice";

interface LearningsPageProps {
  repos: string[];
  learnings: Learning[];
  notice?: string;
}

export function LearningsPage({
  repos,
  learnings,
  notice,
}: LearningsPageProps) {
  return (
    <Layout title="Learnings">
      <PageHeader title="Learnings" description={<>
        Rules Croft applies when reviewing and answering questions about a repo. Max {LEARNING_MAX_CHARS}{" "}
        characters each, {LEARNING_CAP} per repo. Clear a row to delete it. Croft can add one himself: comment{" "}
        <code>@croft add-learning</code> on a PR or in a review thread.
      </>} />
      <Notice>{notice}</Notice>
      <form method="post" action="/learnings">
        {repos.map((repo) => {
          const rows = learnings.filter((learning) => learning.repo === repo);
          return (
            <Fieldset key={repo} legend={<strong className="normal-case tracking-normal">{repo}</strong>} annotation={`${rows.length}/${LEARNING_CAP} brukt`}>
              <div className="learnings-table"><DataTable>
                <thead className="sr-only"><tr><th>Learning</th><th>Source</th><th>Added</th></tr></thead>
                <tbody>
                {rows.map((learning) => (
                  <tr key={learning.id}>
                    <td>
                      <input
                        aria-label={`Learning for ${repo}`}
                        name={`learning_${learning.id}`}
                        defaultValue={learning.text}
                        maxLength={LEARNING_MAX_CHARS}
                        size={80}
                      />
                    </td>
                    <td className="mono muted">
                      {learning.sourceUrl ? (
                        <a href={learning.sourceUrl}>{learning.author ?? "comment"}</a>
                      ) : (
                        "dashboard"
                      )}
                    </td>
                    <td className="mono muted">{fmtDate(learning.createdAt)}</td>
                  </tr>
                ))}
                {rows.length < LEARNING_CAP ? (
                  <tr>
                    <td>
                      <input
                        aria-label={`Add a learning for ${repo}`}
                        name={`new_${repo}`}
                        placeholder="Add a learning"
                        maxLength={LEARNING_MAX_CHARS}
                        size={80}
                      />
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                ) : null}
                </tbody>
              </DataTable></div>
            </Fieldset>
          );
        })}
        {repos.length === 0 ? <p>Add a repo to the allow-list in Settings first.</p> : <Button><Save size={16} aria-hidden="true" />Save</Button>}
      </form>
    </Layout>
  );
}
