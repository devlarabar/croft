import { z } from "zod";
import type { RunReport, RunStatus } from "@croft/core/db/schema";
import { runAgentLoop } from "@croft/core/llm/loop";
import type { AgentTool } from "@croft/core/llm/loop";
import type { ChatMessage, Credential, ProviderAdapter } from "@croft/core/llm/types";
import { openBrowserSession } from "./browser.js";
import type { SaveArtifact, Screenshot } from "./browser.js";
import { makeHttpTool } from "./http.js";
import { makePreviewPostgresTool } from "./postgres.js";
import { testSystemPrompt } from "./prompt.js";
import type { PromptLogin } from "./prompt.js";

const reportSchema = z.object({
  summary: z.string(),
  steps: z.array(
    z.object({
      step: z.string(),
      status: z.enum(["pass", "fail", "not_reached"]),
      notes: z.string().optional(),
      screenshots: z.array(z.string()).optional(),
    }).refine((step) => step.status !== "not_reached" || Boolean(step.notes?.trim()), {
      message: "Skipped steps must name the specific observed blocker.", path: ["notes"],
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

interface TestRunOptions {
  runId: string;
  prNumber?: number;
  previewUrl: string;
  plan: string;
  logins: PromptLogin[];
  repoContext: string | null;
  adapter: ProviderAdapter;
  cred: Credential;
  model: string;
  toolCallCap: number;
  emit(type: string, payload: unknown, artifactKey?: string): Promise<void>;
  saveArtifact?: SaveArtifact;
}

interface TestRunResult {
  status: RunStatus;
  report: RunReport | null;
  screenshots: Screenshot[];
  error: string | null;
}

interface SubmittedReport {
  report: RunReport | null;
}

export async function executeTestRun(opts: TestRunOptions): Promise<TestRunResult> {
  const previewPostgresTool = opts.prNumber ? makePreviewPostgresTool(opts.prNumber) : null;
  const session = await openBrowserSession(opts.runId, opts.saveArtifact);
  const submitted: SubmittedReport = { report: null };
  const reportTool: AgentTool = {
    def: reportToolDef,
    schema: reportSchema,
    async execute(args) {
      submitted.report = reportSchema.parse(args);
      return [{ type: "text", text: "Report recorded." }];
    },
  };
  const tools = [
    ...session.tools,
    makeHttpTool(opts.previewUrl),
    ...(previewPostgresTool ? [previewPostgresTool] : []),
    reportTool,
  ];

  const system = testSystemPrompt({
    previewUrl: opts.previewUrl,
    plan: opts.plan,
    logins: opts.logins,
    repoContext: opts.repoContext,
  });

  let outcome: "done" | "incomplete" | "cap_hit" | "deadline_hit";
  let error: string | null = null;
  let videoUrl: string | null = null;
  try {
    const initial: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Begin. Execute the test plan now." }] },
    ];
    const result = await runAgentLoop({
      adapter: opts.adapter,
      cred: opts.cred,
      model: opts.model,
      system,
      messages: initial,
      tools,
      completionTool: "report",
      toolCallCap: opts.toolCallCap,
      onEvent: opts.emit,
    });
    outcome = result.outcome;
    if (outcome === "incomplete") error = "Croft ended browser execution because the model stopped using tools after repeated continuation requests.";
    if (outcome === "cap_hit") error = "Croft ended browser execution because the tool-call budget was reached.";
    if (outcome === "deadline_hit") error = "Croft ended browser execution because the time limit was reached.";

    if (!submitted.report) {
      await opts.emit("test_run_phase", { phase: "report_collection", reason: outcome });
      await runAgentLoop({
        adapter: opts.adapter,
        cred: opts.cred,
        model: opts.model,
        system,
        messages: [
          ...result.messages,
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${error} Browser tools have now been removed by Croft solely to collect the final report. This is not evidence of a browser crash. Call \`report\` with observed results; mark unvisited steps as not_reached and state the concrete blocker or the execution stop reason above, not an unspecified interruption.`,
              },
            ],
          },
        ],
        tools: [reportTool],
        completionTool: "report",
        toolChoice: "report",
        toolCallCap: 3,
        onEvent: opts.emit,
      });
    }
  } finally {
    videoUrl = await session.close();
  }
  if (videoUrl) await opts.emit("video", { url: videoUrl }, `${opts.runId}/run.webm`);

  const finalReport = submitted.report;
  if (finalReport && error) {
    finalReport.summary = error;
    for (const step of finalReport.steps) {
      if (step.status === "not_reached") step.notes = error;
    }
  }
  if (!finalReport) error = error ? `${error} No report was submitted.` : "agent finished without submitting a report";
  let status: RunStatus = "passed";
  if (outcome === "cap_hit" || outcome === "deadline_hit") status = "cap_hit";
  else if (outcome === "incomplete" || !finalReport) status = "error";
  else if (finalReport.steps.some((step) => step.status === "fail")) status = "failed";
  else if (
    finalReport.steps.filter((step) => step.status === "not_reached").length >
    finalReport.steps.filter((step) => step.status === "pass").length
  )
    // Mostly-skipped runs must not read as green: nothing failed, but the
    // plan was barely exercised.
    status = "partial";
  await opts.emit("test_run_finished", { status, outcome, error });
  return { status, report: finalReport, screenshots: session.screenshots, error };
}
