import { Layout } from "../layout";
import type { RunDetailPageProps } from "./runs.types";
import { StatusCell } from "./status-cell";
import { ButtonLink } from "./button";
import { FileText } from "lucide-react";

export function RunDetailPage({ run, videoUrl, role }: RunDetailPageProps) {
  return (
    <Layout title={`Run ${run.id}`} role={role}>
      <h1>
        {run.repo}#{run.prNumber} — <StatusCell status={run.status} />
      </h1>
      {role === "admin" ? <ButtonLink className="secondary" href={`/runs/${run.id}/logs`}><FileText size={16} aria-hidden="true" />View logs</ButtonLink> : null}
      <video controls src={videoUrl}></video>
    </Layout>
  );
}
