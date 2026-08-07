import { z } from "zod";
import type { ReviewReport, RunStatus } from "@croft/core/db/schema";
import { runAgentLoop } from "@croft/core/llm/loop";
import type { AgentTool } from "@croft/core/llm/loop";
import type { ChatMessage, Credential, ProviderAdapter } from "@croft/core/llm/types";
import { CODE_STANDARDS, REVIEW_SKILL } from "@croft/core/skills";
import { docsTool } from "./docs.js";
import { reviewSystemPrompt } from "./prompt.js";
import { repoTools } from "./repo.js";

const reviewSchema = z.object({
  score: z.number(),
  summary: z.string(),
  praise: z.array(z.string()),
  findings: z.array(
    z.object({
      title: z.string(),
      pointsCost: z.number(),
      detail: z.string(),
      file: z.string(),
      startLine: z.number(),
      endLine: z.number(),
    }),
  ),
  safeToMerge: z.boolean(),
  breakingChanges: z.string(),
});

const submitToolDef = {
  name: "submit_review",
  description: "Submit the final review. Call exactly once.",
  inputSchema: {
    type: "object",
    properties: {
      score: { type: "number", description: "100 minus the point cost of every finding" },
      summary: {
        type: "string",
        description: "What the PR does: beginner-friendly, max 30 words. No praise, no findings.",
      },
      praise: {
        type: "array",
        items: { type: "string" },
        description: "What's great about it. Max 3 items, max 10 words each.",
      },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "The problem in a few words, e.g. 'Unbounded retries'" },
            pointsCost: { type: "number" },
            detail: {
              type: "string",
              description:
                "Max 25 words, extremely casual, cause and effect ('X causes Y. Try Z instead.'). No filler, no jargon.",
            },
            file: { type: "string", description: "Path exactly as it appears in the diff" },
            startLine: { type: "number", description: "New-file line number the finding starts on" },
            endLine: { type: "number" },
          },
          required: ["title", "pointsCost", "detail", "file", "startLine", "endLine"],
        },
      },
      safeToMerge: { type: "boolean" },
      breakingChanges: {
        type: "string",
        description: "The breaking changes, or 'No breaking changes.'",
      },
    },
    required: ["score", "summary", "praise", "findings", "safeToMerge", "breakingChanges"],
  },
};

export async function executeReview(opts: {
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string | null;
  diff: string;
  checkoutDir: string;
  repoContext: string | null;
  adapter: ProviderAdapter;
  cred: Credential;
  model: string;
  toolCallCap?: number;
  emit(type: string, payload: unknown): Promise<void>;
}): Promise<{ status: RunStatus; report: ReviewReport | null }> {
  // A property, not a local: the tool assigns it in a closure, which
  // control-flow analysis can't see.
  const submitted: { report: ReviewReport | null } = { report: null };
  const submitTool: AgentTool = {
    def: submitToolDef,
    schema: reviewSchema,
    async execute(args) {
      submitted.report = reviewSchema.parse(args);
      return [{ type: "text", text: "Review recorded." }];
    },
  };

  const system = reviewSystemPrompt({
    skill: REVIEW_SKILL,
    codeStandards: CODE_STANDARDS,
    repo: opts.repo,
    repoContext: opts.repoContext,
  });
  const initial: ChatMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `PR #${opts.prNumber}: ${opts.prTitle}

Description:
${opts.prBody ?? "(none)"}

Diff:
${opts.diff}

Review it now.`,
        },
      ],
    },
  ];

  const result = await runAgentLoop({
    adapter: opts.adapter,
    cred: opts.cred,
    model: opts.model,
    system,
    messages: initial,
    tools: [...repoTools(opts.checkoutDir), docsTool, submitTool],
    toolCallCap: opts.toolCallCap,
    onEvent: opts.emit,
  });

  if (result.outcome === "cap_hit" && !submitted.report) {
    // The tokens are spent — get the findings out anyway.
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
              text: "You hit the tool-call budget cap. Call `submit_review` now with what you found so far.",
            },
          ],
        },
      ],
      tools: [submitTool],
      toolCallCap: 1,
      onEvent: opts.emit,
    });
  }

  const report = submitted.report;
  if (result.outcome === "cap_hit") return { status: "cap_hit", report };
  if (!report) return { status: "error", report: null };
  return { status: report.safeToMerge ? "passed" : "failed", report };
}
