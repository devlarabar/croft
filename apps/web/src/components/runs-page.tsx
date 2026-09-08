import { Layout } from "../layout";
import type { RunsPageProps } from "./runs.types";
import { StatusCell } from "./status-cell";
import { CopyButton } from "./copy-button";
import { RunActions } from "./run-actions";
import { DataTable } from "./data-table";

export function RunsPage({ runs, page, hasNext, role }: RunsPageProps) {
  return (
    <Layout title="Runs" role={role}>
      <div className="page-head">
        <h1>Runs</h1>
        {role === "admin" ? <a className="btn" href="/new">New run</a> : null}
      </div>
      <DataTable>
        <tr>
          <th>Pull request</th>
          <th>Mode</th>
          <th>Status</th>
          <th>Timing</th>
          <th></th>
        </tr>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>
              <a href={`https://github.com/${run.repo}/pull/${run.prNumber}`}>
                {run.repo}#{run.prNumber}
              </a>
              <div className="mono muted">{run.model}</div>
            </td>
            <td className="mono">{run.mode}</td>
            <td>
              <StatusCell status={run.status} />
              {run.error ? (
                <details>
                  <summary className="mono muted">error</summary>
                  <CopyButton text={run.error} />
                  <div className="mono muted">{run.error}</div>
                </details>
              ) : null}
            </td>
            <td className="mono">
              {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              {run.finishedAt ? ` → ${run.finishedAt.toISOString().slice(11, 16)}` : ""}
            </td>
            <td>
              <a href={`/runs/${run.id}`}>video</a>
              <RunActions run={run} role={role} />
            </td>
          </tr>
        ))}
      </DataTable>
      <p>
        {page > 1 ? <a href={`/runs?page=${page - 1}`}>← Previous</a> : null}
        {page > 1 ? " · " : null}
        Page {page}
        {hasNext ? " · " : null}
        {hasNext ? <a href={`/runs?page=${page + 1}`}>Next →</a> : null}
      </p>
    </Layout>
  );
}
