import { z } from "zod";
import type { RunReport, RunStatus } from "@croft/core/db/schema";
import { runAgentLoop } from "@croft/core/llm/loop";
import type { AgentTool } from "@croft/core/llm/loop";
import type { ChatMessage, Credential, ProviderAdapter } from "@croft/core/llm/types";
import { openBrowserSession } from "./browser.js";
import type { SaveArtifact, Screenshot } from "./browser.js";
import { makeHttpTool } from "./http.js";
import { testSystemPrompt } from "./prompt.js";

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

export async function executeTestRun(opts: {
  runId: string;
  previewUrl: string;
  plan: string;
  login: { username: string; password: string; loginUrl?: string } | null;
  repoContext: string | null;
  adapter: ProviderAdapter;
  cred: Credential;
  model: string;
  toolCallCap?: number;
  emit(type: string, payload: unknown, artifactKey?: string): Promise<void>;
  saveArtifact?: SaveArtifact;
}): Promise<{ status: RunStatus; report: RunReport | null; screenshots: Screenshot[] }> {
  const session = await openBrowserSession(opts.runId, opts.saveArtifact);
  let report: RunReport | null = null;
  const reportTool: AgentTool = {
    def: reportToolDef,
    schema: reportSchema,
    async execute(args) {
      report = args as RunReport;
      return [{ type: "text", text: "Report recorded." }];
    },
  };
  const tools = [...session.tools, makeHttpTool(opts.previewUrl), reportTool];

  const system = testSystemPrompt({
    previewUrl: opts.previewUrl,
    plan: opts.plan,
    login: opts.login,
    repoContext: opts.repoContext,
  });

  let outcome: "done" | "cap_hit";
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
      toolCallCap: opts.toolCallCap,
      onEvent: opts.emit,
    });
    outcome = result.outcome;

    if (outcome === "cap_hit" && !report) {
      // The tokens are spent — get the evidence into a report anyway.
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
                text: "You hit the tool-call budget cap. Call `report` now with results observed so far; mark unvisited steps as not_reached.",
              },
            ],
          },
        ],
        tools: [reportTool],
        toolCallCap: 1,
        onEvent: opts.emit,
      });
    }
  } finally {
    videoUrl = await session.close();
  }
  if (videoUrl) await opts.emit("video", { url: videoUrl }, `${opts.runId}/run.webm`);

  const finalReport = report as RunReport | null;
  let status: RunStatus = "passed";
  if (outcome === "cap_hit") status = "cap_hit";
  else if (!finalReport) status = "error";
  else if (finalReport.steps.some((step) => step.status === "fail")) status = "failed";
  return { status, report: finalReport, screenshots: session.screenshots };
}
