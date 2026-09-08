import { Layout } from "../layout";
import type { RunDetailPageProps } from "./runs.types";
import { StatusCell } from "./status-cell";

export function RunDetailPage({ run, videoUrl, role }: RunDetailPageProps) {
  return (
    <Layout title={`Run ${run.id}`} role={role}>
      <h1>
        {run.repo}#{run.prNumber} — <StatusCell status={run.status} />
      </h1>
      <video controls src={videoUrl}></video>
    </Layout>
  );
}
