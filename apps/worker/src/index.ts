import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  RunReport,
  RunStatus,
  complete,
  createCheckRun,
  db,
  decrypt,
  eventWriter,
  extractTestPlan,
  getConfig,
  getPr,
  getPrDiff,
  getProvider,
  loadCredential,
  postPrComment,
  PLAN_TRIAGE_SKILL,
  schema,
  TEST_PLAN_SKILL,
} from "@croft/core";
import { formatComment } from "./report.js";
import { executeTestRun } from "./testrun.js";

const RUN_ID = process.env.RUN_ID!;
const PREVIEW_URL = process.env.PREVIEW_URL!;
const WEB_URL = process.env.WEB_URL ?? "";

async function setStatus(status: RunStatus, patch: Partial<typeof schema.runs.$inferInsert> = {}) {
  await db.update(schema.runs).set({ status, ...patch }).where(eq(schema.runs.id, RUN_ID));
}

async function main() {
  // Diagnostic: compare against the web app's GET /keyfp.
  console.log("TOKEN_ENC_KEY fp", createHash("sha256").update(process.env.TOKEN_ENC_KEY!).digest("hex").slice(0, 8));
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, RUN_ID));
  if (!run) throw new Error(`run ${RUN_ID} not found`);
  await setStatus("running", { startedAt: new Date() });
  const emit = eventWriter(RUN_ID);

  const cfg = await getConfig();
  const adapter = getProvider(run.providerId);
  const cred = await loadCredential(run.credentialId, adapter.oauth);
  const pr = await getPr(run.repo, run.prNumber);

  // Test plan: PR body section, else generated from the diff. A body plan
  // that is just a CI report ("tests pass", "typecheck clean") with nothing
  // for a reviewer to do is discarded so a plan is generated from the diff.
  // freshPlan skips the PR body entirely and always generates from the diff.
  let plan = run.freshPlan ? null : extractTestPlan(pr.body);
  let generatedPlan: string | null = null;
  if (plan) {
    const verdict = (
      await complete(adapter, cred, run.model, PLAN_TRIAGE_SKILL, plan)
    ).trim();
    if (!verdict.startsWith("USABLE")) {
      await emit("plan_rejected", { plan });
      plan = null;
    }
  }
  if (!plan) {
    const diff = await getPrDiff(run.repo, run.prNumber);
    plan = (
      await complete(
        adapter,
        cred,
        run.model,
        TEST_PLAN_SKILL,
        `PR title: ${pr.title}\n\nPR description:\n${pr.body ?? "(none)"}\n\nDeployment URL: ${PREVIEW_URL}${
          cfg.repoContext[run.repo] ? `\n\nRepository context from its maintainers:\n${cfg.repoContext[run.repo]}` : ""
        }\n\nDiff:\n${diff}`,
      )
    ).trim();
    if (!plan || plan.includes("NOTHING_TESTABLE")) {
      await emit("nothing_testable", {});
      const report: RunReport = {
        summary:
          "Nothing in this PR's diff is user-testable (no usable `## Test plan` section, and the changes have no observable surface). No browser run was performed.",
        steps: [],
      };
      await setStatus("passed", { report, finishedAt: new Date() });
      await createCheckRun(run.repo, pr.head.sha, "neutral", report.summary);
      await postPrComment(
        run.repo,
        run.prNumber,
        `## Croft test run: ⏭️ nothing to test\n\n${report.summary}`,
      );
      return;
    }
    generatedPlan = plan;
    await emit("generated_plan", { plan });
  }

  const login = cfg.previewLogins[run.repo];
  const { status, report, screenshots } = await executeTestRun({
    runId: RUN_ID,
    previewUrl: PREVIEW_URL,
    plan,
    login: login
      ? { username: login.username, password: decrypt(login.encryptedPassword), loginUrl: login.loginUrl }
      : null,
    repoContext: cfg.repoContext[run.repo] ?? null,
    adapter,
    cred,
    model: run.model,
    toolCallCap: cfg.toolCallCap,
    emit,
  });

  const error = report ? null : "agent finished without submitting a report";
  await setStatus(status, { report, error, finishedAt: new Date() });

  // An incomplete run must never masquerade as green: cap_hit/partial → neutral.
  const conclusion =
    status === "passed" ? "success" : status === "cap_hit" || status === "partial" ? "neutral" : "failure";
  await createCheckRun(run.repo, pr.head.sha, conclusion, report?.summary ?? "Run finished without a report.");
  // Comment creation is not idempotent — post it last, once.
  await postPrComment(
    run.repo,
    run.prNumber,
    formatComment({
      status,
      report,
      screenshots,
      runUrl: `${WEB_URL}/runs/${RUN_ID}`,
      generatedPlan,
      error,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    try {
      await setStatus("error", { error: String((err as Error).stack ?? err), finishedAt: new Date() });
    } catch (statusErr) {
      console.error("failed to record error status", statusErr);
    }
    process.exit(1);
  });
