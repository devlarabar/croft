import { notFound } from "next/navigation";
import { RunDetailPage } from "../../../components/run-detail-page";
import { getRun } from "../../../data/runs";
import { dashboardRole } from "../../../dashboard-role";

export default async function Page({ params }: PageProps<"/runs/[id]">) {
  const run = await getRun((await params).id);
  if (!run) notFound();
  return <RunDetailPage run={run} videoUrl={`/runs/${run.id}/video`} role={await dashboardRole()} />;
}
