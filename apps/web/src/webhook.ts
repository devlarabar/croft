import { Webhooks } from "@octokit/webhooks";
import type { Context } from "hono";
import {
  addEyesReaction,
  db,
  getConfig,
  getPr,
  postPrComment,
  replyToReviewComment,
  schema,
} from "@croft/core";
import { learnFromComment } from "./learn.js";
import { answerQuestion } from "./qa.js";
import { startRun } from "./runs.js";

// Lazy: local dev without webhook config must still boot the dashboard.
let _webhooks: Webhooks | undefined;
function webhooks(): Webhooks {
  if (!process.env.GITHUB_WEBHOOK_SECRET) throw new Error("GITHUB_WEBHOOK_SECRET not configured");
  _webhooks ??= new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET });
  return _webhooks;
}

const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

export async function handleWebhook(ctx: Context): Promise<Response> {
  const body = await ctx.req.text();
  const signature = ctx.req.header("x-hub-signature-256") ?? "";
  if (!(await webhooks().verify(body, signature))) return ctx.text("bad signature", 401);

  // GitHub redelivers webhooks: insert-or-ignore the delivery id so a
  // redelivered comment can't start a duplicate run.
  const deliveryId = ctx.req.header("x-github-delivery") ?? "";
  const inserted = await db
    .insert(schema.webhookDeliveries)
    .values({ deliveryId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return ctx.text("duplicate delivery", 200);

  const event = ctx.req.header("x-github-event");
  // Inline review-thread comments arrive as their own event type.
  const isReviewComment = event === "pull_request_review_comment";
  if (event !== "issue_comment" && !isReviewComment) return ctx.text("ignored", 200);
  const payload = JSON.parse(body) as {
    action: string;
    issue?: { number: number; pull_request?: object };
    pull_request?: { number: number };
    comment: {
      id: number;
      body: string;
      html_url: string;
      author_association: string;
      user: { login: string };
    };
    repository: { full_name: string };
  };
  if (payload.action !== "created") return ctx.text("ignored", 200);
  const prNumber = isReviewComment
    ? payload.pull_request?.number
    : payload.issue?.pull_request
      ? payload.issue.number
      : undefined;
  if (!prNumber) return ctx.text("ignored", 200);

  const match = payload.comment.body.trim().match(/^@(?:agent-)?croft\s+([\s\S]+)/i);
  if (!match) return ctx.text("ignored", 200);

  const cfg = await getConfig();
  const repo = payload.repository.full_name;
  if (!cfg.repos.includes(repo)) return ctx.text("repo not allow-listed", 200);

  // Anyone else could spend LLM budget — and the agent reads
  // attacker-controllable PR text while holding GitHub write tools.
  const commenter = payload.comment.user.login;
  const allowed =
    TRUSTED_ASSOCIATIONS.includes(payload.comment.author_association) ||
    cfg.allowedUsers.includes(commenter);
  if (!allowed) return ctx.text("commenter not allowed", 200);

  // Ack receipt on the triggering comment before doing any work.
  await addEyesReaction(repo, payload.comment.id, isReviewComment ? "review" : "issue");

  // Answer where the question was asked: in the thread, or on the PR.
  const reply = (text: string) =>
    isReviewComment
      ? replyToReviewComment(repo, prNumber, payload.comment.id, text)
      : postPrComment(repo, prNumber, text);

  // Master toggle: say so instead of silently ignoring. No LLM calls.
  if (!cfg.webhooksEnabled) {
    await reply("Webhook actions are disabled.");
    return ctx.text("webhooks disabled", 200);
  }

  // Never on PRs from forks.
  const pr = await getPr(repo, prNumber);
  if (!pr.head.repo || pr.head.repo.full_name !== repo) return ctx.text("fork PR", 200);

  const command = match[1]!.trim();
  const testCmd = command.match(/^test(-fresh-plan)?$/i);
  const learnCmd = command.match(/^add-learning\b\s*([\s\S]*)$/i);
  if (testCmd) {
    await startRun({ repo, prNumber, mode: "test", freshPlan: !!testCmd[1] });
  } else if (/^review$/i.test(command)) {
    await startRun({ repo, prNumber, mode: "review" });
  } else if (learnCmd) {
    try {
      const learning = await learnFromComment({
        repo,
        prNumber,
        commentId: payload.comment.id,
        isReviewComment,
        hint: learnCmd[1]!.trim(),
        author: commenter,
        sourceUrl: payload.comment.html_url,
      });
      await reply(`Learned, and I'll apply it to future reviews of \`${repo}\`:\n\n> ${learning}`);
    } catch (err) {
      await reply(`Couldn't add that learning: ${(err as Error).message}`);
    }
  } else {
    await reply(await answerQuestion(repo, prNumber, command));
  }
  return ctx.text("ok", 200);
}
