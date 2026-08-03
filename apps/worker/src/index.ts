import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
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
  runAgentLoop,
  schema,
  TEST_PLAN_SKILL,
} from "@croft/core";
import type { AgentTool, ChatMessage } from "@croft/core";
import { openBrowserSession } from "./browser.js";
import { testSystemPrompt } from "./prompt.js";
import { formatComment } from "./report.js";

const RUN_ID = process.env.RUN_ID!;
const PREVIEW_URL = process.env.PREVIEW_URL!;
const WEB_URL = process.env.WEB_URL ?? "";

const reportSchema = z.object({
  summary: z.string(),
  steps: z.array(
    z.object({
      step: z.string(),
      status: z.enum(["pass", "fail", "not_reached"]),
      notes: z.string().optional(),
      screenshots: z.array(z.string()).optional(),
    }),
  ),
});

const reportToolDef = {
  name: "report",
  description: "Submit the final structured pass/fail result for every test-plan step. Call exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "Short prose summary of the run" },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            step: { type: "string" },
            status: {
              type: "string",
              enum: ["pass", "fail", "not_reached"],
              description:
                "fail = the app misbehaved when the step was performed. Steps that could not be performed (missing tool, environment limitation, test account lacking the data a step assumes) are not_reached, never fail.",
            },
            notes: {
              type: "string",
              description:
                "What you observed, in one concise sentence. No filler like 'successfully' and no restating the step text.",
            },
            screenshots: {
              type: "array",
              items: { type: "string" },
              description:
                "Names of the screenshots you took while performing this step — the exact saved names the screenshot tool returned (e.g. '03-step2-norway-selected').",
            },
          },
          required: ["step", "status"],
        },
      },
    },
    required: ["summary", "steps"],
  },
};

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

  const session = await openBrowserSession(RUN_ID);
  let report: RunReport | null = null;
  const reportTool: AgentTool = {
    def: reportToolDef,
    schema: reportSchema,
    async execute(args) {
      report = args as RunReport;
      return [{ type: "text", text: "Report recorded." }];
    },
  };
  const tools = [...session.tools, reportTool];

  const login = cfg.previewLogins[run.repo];
  const system = testSystemPrompt({
    previewUrl: PREVIEW_URL,
    plan,
    login: login
      ? { username: login.username, password: decrypt(login.encryptedPassword), loginUrl: login.loginUrl }
      : null,
    repoContext: cfg.repoContext[run.repo] ?? null,
  });

  let outcome: "done" | "cap_hit";
  let videoUrl: string | null = null;
  try {
    const initial: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Begin. Execute the test plan now." }] },
    ];
    const result = await runAgentLoop({
      adapter,
      cred,
      model: run.model,
      system,
      messages: initial,
      tools,
      toolCallCap: cfg.toolCallCap,
      onEvent: emit,
    });
    outcome = result.outcome;

    if (outcome === "cap_hit" && !report) {
      // The tokens are spent — get the evidence into a report anyway.
      await runAgentLoop({
        adapter,
        cred,
        model: run.model,
        system,
        messages: [
          ...result.messages,
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "You hit the tool-call budget cap. Call `report` now with results observed so far; mark unvisited steps as not_reached.",
              },
            ],
          },
        ],
        tools: [reportTool],
        toolCallCap: 1,
        onEvent: emit,
      });
    }
  } finally {
    videoUrl = await session.close();
  }
  if (videoUrl) await emit("video", { url: videoUrl }, `${RUN_ID}/run.webm`);

  const r = report as RunReport | null;
  const status: RunStatus =
    outcome === "cap_hit" ? "cap_hit" : !r ? "error" : r.steps.some((s) => s.status === "fail") ? "failed" : "passed";
  await setStatus(status, {
    report: r,
    error: r ? null : "agent finished without submitting a report",
    finishedAt: new Date(),
  });

  // A partial run must never masquerade as green: cap_hit → neutral.
  const conclusion = status === "passed" ? "success" : status === "cap_hit" ? "neutral" : "failure";
  await createCheckRun(run.repo, pr.head.sha, conclusion, r?.summary ?? "Run finished without a report.");
  // Comment creation is not idempotent — post it last, once.
  await postPrComment(
    run.repo,
    run.prNumber,
    formatComment({
      status,
      report: r,
      screenshots: session.screenshots,
      runUrl: `${WEB_URL}/runs/${RUN_ID}`,
      generatedPlan,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    try {
      await setStatus("error", { error: String((err as Error).stack ?? err), finishedAt: new Date() });
    } catch (e) {
      console.error("failed to record error status", e);
    }
    process.exit(1);
  });
