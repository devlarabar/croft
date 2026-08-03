import { Webhooks } from "@octokit/webhooks";
import type { Context } from "hono";
import { addEyesReaction, db, getConfig, getPr, postPrComment, schema } from "@croft/core";
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
  if (event !== "issue_comment") return ctx.text("ignored", 200);
  const payload = JSON.parse(body) as {
    action: string;
    issue: { number: number; pull_request?: object };
    comment: { id: number; body: string; author_association: string; user: { login: string } };
    repository: { full_name: string };
  };
  if (payload.action !== "created" || !payload.issue.pull_request) return ctx.text("ignored", 200);

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
  await addEyesReaction(repo, payload.comment.id);

  // Master toggle: say so instead of silently ignoring. No LLM calls.
  if (!cfg.webhooksEnabled) {
    await postPrComment(repo, payload.issue.number, "Webhook actions are disabled.");
    return ctx.text("webhooks disabled", 200);
  }

  // Never on PRs from forks.
  const pr = await getPr(repo, payload.issue.number);
  if (!pr.head.repo || pr.head.repo.full_name !== repo) return ctx.text("fork PR", 200);

  const command = match[1]!.trim();
  const testCmd = command.match(/^test(-fresh-plan)?$/i);
  if (testCmd) {
    await startRun({ repo, prNumber: payload.issue.number, mode: "test", freshPlan: !!testCmd[1] });
  } else {
    const answer = await answerQuestion(repo, payload.issue.number, command);
    await postPrComment(repo, payload.issue.number, answer);
  }
  return ctx.text("ok", 200);
}
