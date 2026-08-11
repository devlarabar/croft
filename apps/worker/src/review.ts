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
      fixContext: z.string(),
      file: z.string(),
      startLine: z.number(),
      endLine: z.number(),
      agreedWith: z.string().optional(),
    }),
  ),
  safeToMerge: z.boolean(),
  breakingChanges: z.string(),
  inlineAgreements: z.array(z.number()).optional(),
});

export interface ReviewerComments {
  inline: { id: number; author: string; path: string; line: number | null; body: string }[];
  general: { author: string; body: string }[];
}

function formatReviewerComments(comments: ReviewerComments): string {
  const sections: string[] = [];
  if (comments.inline.length) {
    sections.push(
      "Inline diff comments:",
      ...comments.inline.map(
        (comment) =>
          `[id ${comment.id}] @${comment.author} on ${comment.path}${comment.line === null ? "" : `:${comment.line}`}:\n${comment.body}`,
      ),
    );
  }
  if (comments.general.length) {
    sections.push("General comments:", ...comments.general.map((comment) => `@${comment.author}:\n${comment.body}`));
  }
  return sections.join("\n\n");
}

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
            fixContext: {
              type: "string",
              description:
                "Brief for the agent that will fix this. Max 100 words, essential details only: the exact problem, where the relevant code lives, what a correct fix looks like, and any constraint or gotcha the fixer must respect. No pleasantries.",
            },
            file: { type: "string", description: "Path exactly as it appears in the diff" },
            startLine: { type: "number", description: "New-file line number the finding starts on" },
            endLine: { type: "number" },
            agreedWith: {
              type: "string",
              description:
                "Only when the finding agrees with another reviewer's general (non-inline) comment: that reviewer's name",
            },
          },
          required: ["title", "pointsCost", "detail", "fixContext", "file", "startLine", "endLine"],
        },
      },
      safeToMerge: { type: "boolean" },
      breakingChanges: {
        type: "string",
        description: "The breaking changes, or 'No breaking changes.'",
      },
      inlineAgreements: {
        type: "array",
        items: { type: "number" },
        description:
          "Ids of other reviewers' inline comments you agree with; each gets a '+1' reply. Do not also list them as findings.",
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
  reviewerComments: ReviewerComments;
  learnings: string[];
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
    learnings: opts.learnings,
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
${
            opts.reviewerComments.inline.length || opts.reviewerComments.general.length
              ? `\nExisting comments from other reviewers:\n\n${formatReviewerComments(opts.reviewerComments)}\n`
              : ""
          }
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
