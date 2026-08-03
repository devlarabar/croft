import { createPrivateKey } from "node:crypto";
import { App } from "@octokit/app";
import { withRetry } from "./retry.js";

// Lazy: local dev without GITHUB_APP_* env must still boot the dashboard.
let _app: App | undefined;
function app(): App {
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY not configured");
  }
  // Env editors flatten PEM newlines into literal "\n" text; GitHub issues
  // PKCS#1 PEMs but Octokit's WebCrypto signing needs PKCS#8. Normalize both.
  const pem = process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  _app ??= new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: createPrivateKey(pem).export({ type: "pkcs8", format: "pem" }).toString(),
  });
  return _app;
}

export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  return { owner: owner!, name: name! };
}

async function octokitFor(repo: string) {
  const { owner, name } = splitRepo(repo);
  const { data } = await app().octokit.request("GET /repos/{owner}/{repo}/installation", {
    owner,
    repo: name,
  });
  return app().getInstallationOctokit(data.id);
}

const retry3 = { attempts: 3 };

export async function getPr(repo: string, prNumber: number) {
  const kit = await octokitFor(repo);
  const { owner, name } = splitRepo(repo);
  const { data } = await withRetry(
    () => kit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", { owner, repo: name, pull_number: prNumber }),
    retry3,
  );
  return data;
}

export async function getPrDiff(repo: string, prNumber: number): Promise<string> {
  const kit = await octokitFor(repo);
  const { owner, name } = splitRepo(repo);
  const { data } = await withRetry(
    () =>
      kit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo: name,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      }),
    retry3,
  );
  return data as unknown as string;
}

export async function listPrComments(repo: string, prNumber: number) {
  const kit = await octokitFor(repo);
  const { owner, name } = splitRepo(repo);
  const { data } = await withRetry(
    () =>
      kit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo: name,
        issue_number: prNumber,
        per_page: 100,
      }),
    retry3,
  );
  return data;
}

// Adding the same reaction twice is idempotent, so retry is safe.
export async function addEyesReaction(repo: string, commentId: number) {
  const kit = await octokitFor(repo);
  const { owner, name } = splitRepo(repo);
  await withRetry(
    () =>
      kit.request("POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions", {
        owner,
        repo: name,
        comment_id: commentId,
        content: "eyes",
      }),
    retry3,
  );
}

// Comment creation is not idempotent: no retry — create it last, once.
export async function postPrComment(repo: string, prNumber: number, body: string) {
  const kit = await octokitFor(repo);
  const { owner, name } = splitRepo(repo);
  await kit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner,
    repo: name,
    issue_number: prNumber,
    body,
  });
}

export async function createCheckRun(
  repo: string,
  headSha: string,
  conclusion: "success" | "failure" | "neutral",
  summary: string,
) {
  const kit = await octokitFor(repo);
  const { owner, name } = splitRepo(repo);
  await withRetry(
    () =>
      kit.request("POST /repos/{owner}/{repo}/check-runs", {
        owner,
        repo: name,
        name: "croft",
        head_sha: headSha,
        status: "completed",
        conclusion,
        output: { title: "Croft run", summary },
      }),
    retry3,
  );
}

export async function listOpenPrs(repo: string) {
  const kit = await octokitFor(repo);
  const { owner, name } = splitRepo(repo);
  const { data } = await kit.request("GET /repos/{owner}/{repo}/pulls", {
    owner,
    repo: name,
    state: "open",
    per_page: 50,
  });
  return data;
}

// Searches PR comments — comments only, never the description — for one
// containing "preview deployment" and a link. First URL in that comment wins.
// Checks once; never waits, never polls.
export async function discoverPreviewUrl(repo: string, prNumber: number): Promise<string | null> {
  const comments = await listPrComments(repo, prNumber);
  for (const c of comments) {
    if (!/preview deployment/i.test(c.body ?? "")) continue;
    const m = c.body?.match(/https?:\/\/[^\s)>\]"']+/);
    if (m) return m[0];
  }
  return null;
}
