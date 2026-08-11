import { and, eq, inArray } from "drizzle-orm";
import { createCheckRun, db, getPr, schema } from "@croft/core";
import { getJobRunState } from "./scaleway.js";

const LIVE_JOB_STATES = ["queued", "scheduled", "running"];

// A SIGKILLed worker (job timeout, OOM) can't record its own failure, so its
// run would show "running" forever. Reap runs whose Scaleway job has ended.
export async function reapDeadRuns(): Promise<void> {
  const stuck = await db
    .select()
    .from(schema.runs)
    .where(inArray(schema.runs.status, ["starting", "running"]));
  for (const run of stuck) {
    if (!run.jobRunId) continue;
    const state = await getJobRunState(run.jobRunId);
    if (LIVE_JOB_STATES.includes(state)) continue;
    // Guarded update: skip if the worker recorded a result after our select.
    const [reaped] = await db
      .update(schema.runs)
      .set({
        status: "error",
        error: `worker job ended (${state}) without reporting a result — likely killed by the job's time or memory limit`,
        finishedAt: new Date(),
      })
      .where(and(eq(schema.runs.id, run.id), inArray(schema.runs.status, ["starting", "running"])))
      .returning();
    if (!reaped) continue;
    const pr = await getPr(run.repo, run.prNumber);
    await createCheckRun(run.repo, pr.head.sha, "failure", `Croft ${run.mode} run was killed (job ${state}).`);
  }
}
