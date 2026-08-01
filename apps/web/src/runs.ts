import { eq } from "drizzle-orm";
import {
  db,
  discoverPreviewUrl,
  getConfig,
  postPrComment,
  schema,
} from "@croft/core";
import type { RunMode } from "@croft/core";
import { startJob } from "./scaleway.js";

export interface StartRunResult {
  runId: string;
  started: boolean;
  reason?: string;
}

// Shared by UI "Run" and the `@croft test` webhook: one code path.
export async function startRun(opts: {
  repo: string;
  prNumber: number;
  mode: RunMode;
  previewUrl?: string;
}): Promise<StartRunResult> {
  const cfg = await getConfig();
  if (!cfg.activeModel) throw new Error("No active model configured — set one on the Models page.");
  const { providerId, model, credentialId } = cfg.activeModel;

  // Row first: a job that never launches is a visible error, not a run in limbo.
  const [run] = await db
    .insert(schema.runs)
    .values({ repo: opts.repo, prNumber: opts.prNumber, mode: opts.mode, providerId, model, credentialId })
    .returning();
  const runId = run!.id;

  // Preview discovery is orchestration: a UI-supplied URL wins; otherwise check
  // the PR's comments once. No URL → comment, no job, nothing billed.
  const previewUrl = opts.previewUrl || (await discoverPreviewUrl(opts.repo, opts.prNumber));
  if (!previewUrl) {
    await db
      .update(schema.runs)
      .set({ status: "error", error: "no preview URL found", finishedAt: new Date() })
      .where(eq(schema.runs.id, runId));
    await postPrComment(
      opts.repo,
      opts.prNumber,
      "Croft couldn't find a preview URL for this PR (no comment mentioning a preview deployment, and none was supplied). No run was started.",
    );
    return { runId, started: false, reason: "no preview URL" };
  }

  await db.update(schema.runs).set({ status: "starting", previewUrl }).where(eq(schema.runs.id, runId));
  try {
    await startJob({
      RUN_ID: runId,
      PR_NUMBER: String(opts.prNumber),
      PREVIEW_URL: previewUrl,
    });
  } catch (err) {
    await db
      .update(schema.runs)
      .set({ status: "error", error: String((err as Error).message), finishedAt: new Date() })
      .where(eq(schema.runs.id, runId));
    return { runId, started: false, reason: "job start failed" };
  }
  return { runId, started: true };
}
