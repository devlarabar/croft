import { getRun } from "../../../../data/runs";
import { redirect, route } from "../../../../http";
import { isRetryable } from "../../../../run-status";
import { startRun } from "../../../../runs";

export const POST = route(async (_request, { params }: RouteContext<"/runs/[id]/retry">) => {
  const run = await getRun((await params).id);
  if (!run) return new Response("404 Not Found", { status: 404 });
  if (!isRetryable(run.status)) return new Response("run is not retryable", { status: 400 });
  const result = await startRun({
    repo: run.repo,
    prNumber: run.prNumber,
    mode: run.mode,
    previewUrl: run.previewUrl ?? undefined,
    freshPlan: run.freshPlan,
  });
  if (!result.started) return redirect(`/new?error=${encodeURIComponent(result.reason)}`);
  return redirect("/runs");
});
