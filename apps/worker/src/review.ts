import { z } from "zod";
import { compactMovedLines } from "@croft/core/diff";
import type { ReviewReport, RunStatus } from "@croft/core/db/schema";
import { runAgentLoop } from "@croft/core/llm/loop";
import type { AgentTool } from "@croft/core/llm/loop";
import type { ChatMessage, Credential, ProviderAdapter } from "@croft/core/llm/types";
import { CODE_STANDARDS, REVIEW_SKILL } from "@croft/core/skills";
import { docsTool } from "./docs.js";
import { reviewSystemPrompt } from "./prompt.js";
import { repoTools } from "./repo.js";

const REVIEW_EXPLORATION_MS = 24 * 60_000;
const FINAL_SUBMISSION_MS = 3 * 60_000;

const reviewSchema = z.object({
  score: z.number(),
  summary: z.string(),
  praise: z.array(z.string()),
  findings: z.array(
    z.object({
      title: z.string(),
      pointsCost: z.number(),
      detail: z.string(),
      fixContext: z.string().optional(),
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

const submitToolDef = (agentFixContext: boolean) => ({
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
            ...(agentFixContext
              ? {
                  fixContext: {
                    type: "string",
                    description:
                      "Brief for the agent that will fix this. Max 100 words, essential details only: the exact problem, where the relevant code lives, what a correct fix looks like, and any constraint or gotcha the fixer must respect. No pleasantries.",
                  },
                }
              : {}),
            file: { type: "string", description: "Path exactly as it appears in the diff" },
            startLine: { type: "number", description: "New-file line number the finding starts on" },
            endLine: { type: "number" },
            agreedWith: {
              type: "string",
              description:
                "Only when the finding agrees with another reviewer's general (non-inline) comment: that reviewer's name",
            },
          },
          required: [
            "title",
            "pointsCost",
            "detail",
            ...(agentFixContext ? ["fixContext"] : []),
            "file",
            "startLine",
            "endLine",
          ],
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
});

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
  agentFixContext: boolean;
  emit(type: string, payload: unknown): Promise<void>;
}): Promise<{
  status: RunStatus;
  report: ReviewReport | null;
  incompleteReason: "time_limit" | "tool_cap" | null;
}> {
  // A property, not a local: the tool assigns it in a closure, which
  // control-flow analysis can't see.
  const submitted: { report: ReviewReport | null } = { report: null };
  const submitTool: AgentTool = {
    def: submitToolDef(opts.agentFixContext),
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
${compactMovedLines(opts.diff)}

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
    deadlineAt: Date.now() + REVIEW_EXPLORATION_MS,
    onEvent: opts.emit,
  });

  if (result.outcome !== "done" && !submitted.report) {
    const reason = result.outcome === "deadline_hit" ? "review time limit" : "tool-call budget cap";
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
              text: `You hit the ${reason}. Call \`submit_review\` now with what you found so far.`,
            },
          ],
        },
      ],
      tools: [submitTool],
      toolCallCap: 1,
      deadlineAt: Date.now() + FINAL_SUBMISSION_MS,
      onEvent: opts.emit,
    });
  }

  const report = submitted.report;
  const incompleteReason =
    result.outcome === "deadline_hit" ? "time_limit" : result.outcome === "cap_hit" ? "tool_cap" : null;
  if (incompleteReason) return { status: "cap_hit", report, incompleteReason };
  if (!report) return { status: "error", report: null, incompleteReason: null };
  return { status: report.safeToMerge ? "passed" : "failed", report, incompleteReason: null };
}
