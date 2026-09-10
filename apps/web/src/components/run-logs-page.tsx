import { ChevronDown, ChevronRight, Play, RefreshCw } from "lucide-react";
import { Layout } from "../layout";
import { fmtDate } from "../format-date";
import type { RunEvent } from "../data/run-events";
import type { Run } from "./runs.types";
import { ButtonLink } from "./button";
import { Card } from "./card";
import { PageHeader } from "./page-header";
import { StatusCell } from "./status-cell";
import { RunLogExport } from "./run-log-export";

interface RunLogsPageProps {
  run: Run;
  events: RunEvent[];
  nextCursor?: number;
}

export function RunLogsPage({ run, events, nextCursor }: RunLogsPageProps) {
  const path = `/runs/${run.id}/logs`;
  return (
    <Layout title="Run logs">
      <PageHeader title="Run logs" description={`${run.repo}#${run.prNumber} · ${run.mode} · ${run.model}`}>
        <div className="form-row">
          <ButtonLink className="secondary" href={`/runs/${run.id}`}><Play size={16} aria-hidden="true" />Video</ButtonLink>
          <ButtonLink className="secondary" href={path}><RefreshCw size={16} aria-hidden="true" />Latest events</ButtonLink>
        </div>
      </PageHeader>
      <Card>
        <div className="form-row"><StatusCell status={run.status} /><span>Started: {run.startedAt ? fmtDate(run.startedAt) : "Not started"}</span>{run.finishedAt ? <span>Finished: {fmtDate(run.finishedAt)}</span> : null}</div>
        <p className="caption muted">Run ID: {run.id}{run.jobRunId ? ` · Scaleway job: ${run.jobRunId}` : ""}</p>
        {run.error ? <pre>{run.error}</pre> : null}
      </Card>
      <RunLogExport runId={run.id} />
      <p className="sub">Newest events first. Payloads may contain credentials or application data; only admins can view them. These are agent events, not container logs.</p>
      <Card>
        {events.length === 0 ? <p>No events recorded for this page.</p> : events.map((event) => (
          <details key={event.seq} className="run-event">
            <summary><ChevronRight size={16} aria-hidden="true" /><span className="mono muted">#{event.seq}</span><strong>{event.type}</strong><time className="caption muted" dateTime={event.createdAt.toISOString()}>{fmtDate(event.createdAt)}</time></summary>
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          </details>
        ))}
      </Card>
      {nextCursor ? <ButtonLink className="secondary" href={`${path}?before=${nextCursor}`}><ChevronDown size={16} aria-hidden="true" />Older events</ButtonLink> : null}
    </Layout>
  );
}
