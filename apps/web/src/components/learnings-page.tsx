import { Layout } from "../layout";
import type { Learning } from "@croft/core";
import { LEARNING_CAP, LEARNING_MAX_CHARS } from "@croft/core";
import { fmtDate } from "../format-date";
import { DataTable } from "./data-table";
import { Fieldset } from "./fieldset";
import { Button } from "./button";

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
      <h1>Learnings</h1>
      <p className="sub">
        Rules Croft applies when reviewing and answering questions about a repo. Max {LEARNING_MAX_CHARS}{" "}
        characters each, {LEARNING_CAP} per repo. Clear a row to delete it. Croft can add one himself: comment{" "}
        <code>@croft add-learning</code> on a PR or in a review thread.
      </p>
      {notice ? <p>{notice}</p> : null}
      <form method="post" action="/learnings">
        {repos.map((repo) => {
          const rows = learnings.filter((learning) => learning.repo === repo);
          return (
            <Fieldset key={repo} legend={`${repo} (${rows.length}/${LEARNING_CAP})`}>
              <DataTable>
                <tr>
                  <th>Learning</th>
                  <th>Source</th>
                  <th>Added</th>
                </tr>
                {rows.map((learning) => (
                  <tr key={learning.id}>
                    <td>
                      <input
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
                        name={`new_${repo}`}
                        placeholder="Add a learning"
                        maxLength={LEARNING_MAX_CHARS}
                        size={80}
                      />
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                ) : null}
              </DataTable>
            </Fieldset>
          );
        })}
        {repos.length === 0 ? <p>Add a repo to the allow-list in Settings first.</p> : <Button>Save</Button>}
      </form>
    </Layout>
  );
}
