import { Webhooks } from "@octokit/webhooks";
import type { Context } from "hono";
import { db, getConfig, getPr, postPrComment, schema } from "@croft/core";
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

export async function handleWebhook(c: Context): Promise<Response> {
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? "";
  if (!(await webhooks().verify(body, signature))) return c.text("bad signature", 401);

  // GitHub redelivers webhooks: insert-or-ignore the delivery id so a
  // redelivered comment can't start a duplicate run.
  const deliveryId = c.req.header("x-github-delivery") ?? "";
  const inserted = await db
    .insert(schema.webhookDeliveries)
    .values({ deliveryId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return c.text("duplicate delivery", 200);

  const event = c.req.header("x-github-event");
  if (event !== "issue_comment") return c.text("ignored", 200);
  const payload = JSON.parse(body) as {
    action: string;
    issue: { number: number; pull_request?: object };
    comment: { body: string; author_association: string; user: { login: string } };
    repository: { full_name: string };
  };
  if (payload.action !== "created" || !payload.issue.pull_request) return c.text("ignored", 200);

  const match = payload.comment.body.trim().match(/^@(?:agent-)?croft\s+([\s\S]+)/i);
  if (!match) return c.text("ignored", 200);

  const cfg = await getConfig();
  // Master toggle: still ACK 200, take no action.
  if (!cfg.webhooksEnabled) return c.text("webhooks disabled", 200);

  const repo = payload.repository.full_name;
  if (!cfg.repos.includes(repo)) return c.text("repo not allow-listed", 200);

  // Anyone else could spend LLM budget — and the agent reads
  // attacker-controllable PR text while holding GitHub write tools.
  const commenter = payload.comment.user.login;
  const allowed =
    TRUSTED_ASSOCIATIONS.includes(payload.comment.author_association) ||
    cfg.allowedUsers.includes(commenter);
  if (!allowed) return c.text("commenter not allowed", 200);

  // Never on PRs from forks.
  const pr = await getPr(repo, payload.issue.number);
  if (!pr.head.repo || pr.head.repo.full_name !== repo) return c.text("fork PR", 200);

  const command = match[1]!.trim();
  if (/^test$/i.test(command)) {
    await startRun({ repo, prNumber: payload.issue.number, mode: "test" });
  } else {
    const answer = await answerQuestion(repo, payload.issue.number, command);
    await postPrComment(repo, payload.issue.number, answer);
  }
  return c.text("ok", 200);
}
