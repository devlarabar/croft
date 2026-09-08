import { Webhooks } from "@octokit/webhooks";
import { z } from "zod";
import {
  addEyesReaction,
  botLogin,
  db,
  getConfig,
  getPr,
  postPrComment,
  replyToReviewComment,
  schema,
} from "@croft/core";
import { learnFromComment } from "./learn";
import { answerQuestion } from "./qa";
import { startRun } from "./runs";

let webhookVerifier: Webhooks | undefined;
function webhooks(): Webhooks {
  if (!process.env.GITHUB_WEBHOOK_SECRET) throw new Error("GITHUB_WEBHOOK_SECRET not configured");
  webhookVerifier ??= new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET });
  return webhookVerifier;
}

const TRUSTED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];
const repositorySchema = z.object({ full_name: z.string() });
const pullRequestSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number(), draft: z.boolean(), head: z.object({ repo: repositorySchema.nullable() }),
  }),
  requested_reviewer: z.object({ login: z.string() }).optional(),
  repository: repositorySchema,
});
const commentSchema = z.object({
  action: z.string(),
  issue: z.object({ number: z.number(), pull_request: z.object({}).optional() }).optional(),
  pull_request: z.object({ number: z.number() }).optional(),
  comment: z.object({
    id: z.number(), body: z.string(), html_url: z.string(), author_association: z.string(),
    user: z.object({ login: z.string() }),
  }),
  repository: repositorySchema,
});

async function handlePullRequest(body: string): Promise<Response> {
  const payload = pullRequestSchema.parse(JSON.parse(body));
  const requested = payload.action === "review_requested";
  if (!requested && payload.action !== "opened" && payload.action !== "ready_for_review") return new Response("ignored");
  if (payload.pull_request.draft) return new Response("draft PR");

  const cfg = await getConfig();
  const repo = payload.repository.full_name;
  if (requested) {
    if (payload.requested_reviewer?.login !== (await botLogin())) return new Response("another reviewer");
    if (!cfg.repos.includes(repo)) return new Response("repo not allow-listed");
  } else if (!cfg.autoReviewRepos.includes(repo)) {
    return new Response("repo not opted in");
  }
  if (!cfg.webhooksEnabled) return new Response("webhooks disabled");
  const head = payload.pull_request.head.repo;
  if (!head || head.full_name !== repo) return new Response("fork PR");

  await startRun({ repo, prNumber: payload.pull_request.number, mode: "review" });
  return new Response("ok");
}

export async function handleWebhook(request: Request): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!(await webhooks().verify(body, signature))) return new Response("bad signature", { status: 401 });

  // GitHub redelivers webhooks; each delivery starts work at most once.
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  const inserted = await db.insert(schema.webhookDeliveries).values({ deliveryId }).onConflictDoNothing().returning();
  if (inserted.length === 0) return new Response("duplicate delivery");

  const event = request.headers.get("x-github-event");
  if (event === "pull_request") return handlePullRequest(body);
  const isReviewComment = event === "pull_request_review_comment";
  if (event !== "issue_comment" && !isReviewComment) return new Response("ignored");
  const payload = commentSchema.parse(JSON.parse(body));
  if (payload.action !== "created") return new Response("ignored");
  let prNumber = payload.pull_request?.number;
  if (!isReviewComment) prNumber = payload.issue?.pull_request ? payload.issue.number : undefined;
  if (!prNumber) return new Response("ignored");

  const match = payload.comment.body.trim().match(/^@(?:croft|agent-croft(?:\[bot\])?)\s+([\s\S]+)/i);
  if (!match) return new Response("ignored");

  const cfg = await getConfig();
  const repo = payload.repository.full_name;
  if (!cfg.repos.includes(repo)) return new Response("repo not allow-listed");
  const commenter = payload.comment.user.login;
  const allowed = TRUSTED_ASSOCIATIONS.includes(payload.comment.author_association) || cfg.allowedUsers.includes(commenter);
  if (!allowed) return new Response("commenter not allowed");

  const commentKind = isReviewComment ? "review" : "issue";
  await addEyesReaction(repo, payload.comment.id, commentKind);
  const number = prNumber;
  const reply = (text: string) => isReviewComment
    ? replyToReviewComment(repo, number, payload.comment.id, text)
    : postPrComment(repo, number, text);

  if (!cfg.webhooksEnabled) {
    await reply("Webhook actions are disabled.");
    return new Response("webhooks disabled");
  }

  const pr = await getPr(repo, prNumber);
  if (!pr.head.repo || pr.head.repo.full_name !== repo) return new Response("fork PR");

  const command = z.string().parse(match[1]).trim();
  const testCmd = command.match(/^test(-fresh-plan)?\b/i);
  const learnCmd = command.match(/^add-learning\b\s*([\s\S]*)$/i);
  if (testCmd) {
    await startRun({ repo, prNumber, mode: "test", freshPlan: !!testCmd[1] });
  } else if (/^review\b/i.test(command)) {
    await startRun({ repo, prNumber, mode: "review" });
  } else if (learnCmd) {
    try {
      const learning = await learnFromComment({
        repo,
        prNumber,
        commentId: payload.comment.id,
        kind: commentKind,
        hint: z.string().parse(learnCmd[1]).trim(),
        author: commenter,
        sourceUrl: payload.comment.html_url,
      });
      await reply(`Learned, and I'll apply it to future reviews of \`${repo}\`:\n\n> ${learning}`);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      await reply(`Couldn't add that learning: ${error.message}`);
    }
  } else {
    const response = await answerQuestion({
      repo,
      prNumber,
      question: command,
      comment: {
        id: payload.comment.id,
        kind: commentKind,
        author: commenter,
        sourceUrl: payload.comment.html_url,
      },
    });
    if (response.startReview) await startRun({ repo, prNumber, mode: "review" });
    else await reply(response.text);
  }
  return new Response("ok");
}
