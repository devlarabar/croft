import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  RunReport,
  RunStatus,
  botLogin,
  complete,
  createCheckRun,
  createPrReview,
  db,
  decrypt,
  eventWriter,
  extractTestPlan,
  finishRunFlavour,
  getConfig,
  getPr,
  getPrDiff,
  getProvider,
  installationToken,
  listLearnings,
  listPrComments,
  listPrReviewComments,
  loadCredential,
  postPrComment,
  redact,
  replyToReviewComment,
  PLAN_TRIAGE_SKILL,
  schema,
  TEST_PLAN_SKILL,
} from "@croft/core";
import { formatComment, formatReview } from "./report.js";
import { checkoutPr } from "./repo.js";
import { executeReview } from "./review.js";
import { executeTestRun } from "./testrun.js";

const RUN_ID = process.env.RUN_ID!;
const PREVIEW_URL = process.env.PREVIEW_URL!;
const WEB_URL = process.env.WEB_URL ?? "";
const flavourSchema = z.object({
  ongoing: z.string().trim().startsWith("Croft is ").max(200),
  completed: z.string().trim().startsWith("Croft ").max(200),
});
let flavourText: string | null = null;
let completedFlavourText: string | null = null;

async function setStatus(status: RunStatus, patch: Partial<typeof schema.runs.$inferInsert> = {}) {
  if (patch.flavourText) flavourText = patch.flavourText;
  if (patch.finishedAt && completedFlavourText) {
    flavourText = completedFlavourText;
    patch.flavourText = completedFlavourText;
  } else if (patch.finishedAt && flavourText) {
    flavourText = finishRunFlavour(flavourText);
    patch.flavourText = flavourText;
  }
  await db.update(schema.runs).set({ status, ...patch }).where(eq(schema.runs.id, RUN_ID));
}

async function main() {
  // Diagnostic: compare against the web app's GET /keyfp.
  console.log("TOKEN_ENC_KEY fp", createHash("sha256").update(process.env.TOKEN_ENC_KEY!).digest("hex").slice(0, 8));
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, RUN_ID));
  if (!run) throw new Error(`run ${RUN_ID} not found`);
  flavourText = run.flavourText;
  await setStatus("running", { startedAt: new Date() });
  const emit = eventWriter(RUN_ID);

  const cfg = await getConfig();
  const adapter = getProvider(run.providerId);
  const cred = await loadCredential(run.credentialId, adapter.oauth);
  const pr = await getPr(run.repo, run.prNumber);
  // Plan calls send the whole diff: their tokens belong in the run's ledger too.
  const ask = async (system: string, prompt: string) => {
    const { text, usage } = await complete(adapter, cred, run.model, system, prompt);
    if (usage) await emit("usage", usage);
    return text.trim();
  };
  const author = pr.user?.login;
  const authorContext = author ? `Author: @${author}` : "The PR author is unavailable.";
  const generatedFlavour = flavourSchema.parse(
    JSON.parse(
      await ask(
        "Write Croft's playful activity status. Return only JSON with ongoing and completed strings. Each must be one punchy sentence under 20 words and specific to the PR. Ongoing must begin 'Croft is'; completed must begin 'Croft' and use natural past tense; otherwise they differ only in tense. Do not use markdown or invent details beyond the title.",
        `Mode: ${run.mode}\nPR #${run.prNumber}\n${authorContext}\nTitle: ${pr.title}`,
      ),
    ),
  );
  flavourText = generatedFlavour.ongoing;
  completedFlavourText = generatedFlavour.completed;
  await setStatus("running", { flavourText });

  if (run.mode === "review") {
    const diff = await getPrDiff(run.repo, run.prNumber);
    const checkoutDir = await checkoutPr(run.repo, pr.head.sha, await installationToken(run.repo));
    const [self, issueComments, inlineComments] = await Promise.all([
      botLogin(),
      listPrComments(run.repo, run.prNumber),
      listPrReviewComments(run.repo, run.prNumber),
    ]);
    const reviewerComments = {
      inline: inlineComments.flatMap((comment) =>
        comment.user && comment.user.login !== self
          ? [{ id: comment.id, author: comment.user.login, path: comment.path, line: comment.line ?? null, body: comment.body }]
          : [],
      ),
      general: issueComments.flatMap((comment) =>
        comment.user && comment.user.login !== self ? [{ author: comment.user.login, body: comment.body ?? "" }] : [],
      ),
    };
    const { status, report, incompleteReason } = await executeReview({
      repo: run.repo,
      prNumber: run.prNumber,
      prTitle: pr.title,
      prBody: pr.body,
      diff,
      checkoutDir,
      repoContext: cfg.repoContext[run.repo] ?? null,
      reviewerComments,
      learnings: (await listLearnings(run.repo)).map((learning) => learning.text),
      adapter,
      cred,
      model: run.model,
      toolCallCap: cfg.toolCallCap,
      agentFixContext: cfg.agentFixContext,
      emit,
    });
    if (!report) {
      await setStatus("error", { error: "agent finished without submitting a review", finishedAt: new Date() });
      await createCheckRun(run.repo, pr.head.sha, "failure", "Croft errored before submitting a review.");
      return;
    }
    await setStatus(status, { report, finishedAt: new Date() });
    // The check only fails when the run itself errors; a not-safe-to-merge
    // review (and a cap-hit run) reads as neutral, never as failed CI.
    const conclusion = report.safeToMerge && status !== "cap_hit" ? "success" : "neutral";
    const checkSummary = incompleteReason
      ? `${report.summary} Croft submitted early after reaching its ${incompleteReason === "time_limit" ? "review time" : "tool-call"} limit.`
      : report.summary;
    await createCheckRun(run.repo, pr.head.sha, conclusion, checkSummary);
    const findingsPing = cfg.findingsPingAuthor ? pr.user?.login ?? null : cfg.findingsPing;
    const { body, comments } = formatReview(report, diff, findingsPing, incompleteReason);
    await createPrReview(run.repo, run.prNumber, pr.head.sha, body, comments);
    // Replies are not idempotent either; ids the model invented are dropped.
    const knownInlineIds = new Set(reviewerComments.inline.map((comment) => comment.id));
    for (const commentId of report.inlineAgreements ?? []) {
      if (knownInlineIds.has(commentId)) await replyToReviewComment(run.repo, run.prNumber, commentId, "+1");
    }
    return;
  }

  // Test plan: PR body section, else generated from the diff. A body plan
  // that is just a CI report ("tests pass", "typecheck clean") with nothing
  // for a reviewer to do is discarded so a plan is generated from the diff.
  // freshPlan skips the PR body entirely and always generates from the diff.
  let plan = run.freshPlan ? null : extractTestPlan(pr.body);
  let generatedPlan: string | null = null;
  if (plan) {
    const verdict = await ask(PLAN_TRIAGE_SKILL, plan);
    if (!verdict.startsWith("USABLE")) {
      await emit("plan_rejected", { plan });
      plan = null;
    }
  }
  if (!plan) {
    const diff = await getPrDiff(run.repo, run.prNumber);
    plan = await ask(
      TEST_PLAN_SKILL,
      `PR title: ${pr.title}\n\nPR description:\n${pr.body ?? "(none)"}\n\nDeployment URL: ${PREVIEW_URL}${
        cfg.repoContext[run.repo] ? `\n\nRepository context from its maintainers:\n${cfg.repoContext[run.repo]}` : ""
      }\n\nDiff:\n${diff}`,
    );
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

  const logins = (cfg.previewLogins[run.repo] ?? []).map((login) => ({
    label: login.label,
    username: login.username,
    password: decrypt(login.encryptedPassword),
    loginUrl: login.loginUrl,
  }));
  const { status, report, screenshots } = await executeTestRun({
    runId: RUN_ID,
    previewUrl: PREVIEW_URL,
    plan,
    logins,
    repoContext: cfg.repoContext[run.repo] ?? null,
    adapter,
    cred,
    model: run.model,
    toolCallCap: cfg.toolCallCap,
    emit,
  });

  const error = report ? null : "agent finished without submitting a report";
  await setStatus(status, { report, error, finishedAt: new Date() });

  // The check only fails when the run itself errors; failed/partial/cap_hit
  // runs read as neutral so CI never shows red for app findings.
  const conclusion = status === "passed" ? "success" : status === "error" ? "failure" : "neutral";
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
    const details = redact(String((err as Error).stack ?? err));
    console.error(details);
    try {
      await setStatus("error", { error: details, finishedAt: new Date() });
      const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, RUN_ID));
      if (run) {
        const pr = await getPr(run.repo, run.prNumber);
        await createCheckRun(run.repo, pr.head.sha, "failure", "Croft run errored.");
      }
    } catch (statusErr) {
      console.error("failed to record error status", statusErr);
    }
    process.exit(1);
  });
