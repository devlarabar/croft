import { db, finishRunFlavour, schema } from "@croft/core";
import { eq } from "drizzle-orm";
import { getRun } from "../../../../data/runs";
import { redirect, route } from "../../../../http";
import { isCancelable } from "../../../../run-status";
import { stopJob } from "../../../../scaleway";

export const POST = route(async (_request, { params }: RouteContext<"/runs/[id]/cancel">) => {
  const run = await getRun((await params).id);
  if (!run) return new Response("404 Not Found", { status: 404 });
  if (!isCancelable(run.status)) return new Response("run is not cancelable", { status: 400 });
  if (run.jobRunId) {
    try {
      await stopJob(run.jobRunId);
    } catch (error) {
      console.error(`stop job for run ${run.id}:`, error);
    }
  }
  await db.update(schema.runs).set({
    status: "canceled",
    flavourText: run.flavourText ? finishRunFlavour(run.flavourText) : null,
    finishedAt: new Date(),
  }).where(eq(schema.runs.id, run.id));
  return redirect("/runs");
});
