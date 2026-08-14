import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  addLearning,
  authorizeUrl,
  db,
  decrypt,
  encrypt,
  exchangeCode,
  finishRunFlavour,
  generatePkce,
  getConfig,
  getProvider,
  LEARNING_MAX_CHARS,
  listOpenPrs,
  PROVIDERS,
  publicUrl,
  schema,
  updateConfig,
} from "@croft/core";
import type { PreviewLogin } from "@croft/core";
import { getLatestActivity } from "./activity.js";
import { exportZip, purge } from "./export.js";
import {
  ChatPage,
  ExportPage,
  LearningsPage,
  ModelsPage,
  NewRunPage,
  OAuthPastePage,
  RunDetailPage,
  RunsPage,
  SettingsPage,
  type OpenPr,
} from "./pages.js";
import { answerQuestion } from "./qa.js";
import { startRun } from "./runs.js";
import { reapDeadRuns } from "./watchdog.js";
import {
  getOAuthState,
  githubExchange,
  githubLoginUrl,
  newState,
  requireAuth,
  setOAuthState,
  setSession,
} from "./session.js";
import { stopJob } from "./scaleway.js";
import { handleLocalRun } from "./localrun.js";
import { handleWebhook } from "./webhook.js";

const app = new Hono();

// Single-user dashboard: show the real error instead of a bare 500.
app.onError((err, ctx) => {
  console.error(err);
  return ctx.text(`${err.message}\n\n${err.stack ?? ""}`, 500);
});

// Public endpoints; everything else requires the dashboard session.
app.get("/api/v1/activity", getLatestActivity);
app.post("/api/webhooks/github", handleWebhook);
// Ad-hoc local runs — the route only exists on the auth-less dev stack.
if (process.env.DEV_NO_AUTH === "1") app.post("/api/local-runs", handleLocalRun);
const favicon = readFileSync(new URL("../public/favicon.png", import.meta.url));
app.get("/favicon.ico", (ctx) => ctx.body(favicon, 200, { "Content-Type": "image/png" }));
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
app.get("/styles.css", (ctx) => ctx.body(styles, 200, { "Content-Type": "text/css" }));
app.get("/login", (ctx) => {
  const state = newState();
  setOAuthState(ctx, { provider: "github-login", state, verifier: "" });
  return ctx.redirect(githubLoginUrl(state));
});
app.get("/login/callback", async (ctx) => {
  const oauthState = getOAuthState(ctx);
  if (!oauthState || oauthState.provider !== "github-login" || oauthState.state !== ctx.req.query("state")) {
    return ctx.text("bad oauth state", 400);
  }
  const login = await githubExchange(ctx.req.query("code") ?? "");
  if (!login || login !== process.env.DASHBOARD_USER) return ctx.text("forbidden", 403);
  setSession(ctx, login);
  return ctx.redirect("/runs");
});

app.use("*", requireAuth);

app.get("/", (ctx) => ctx.redirect("/runs"));

app.get("/runs", async (ctx) => {
  const runs = await db.select().from(schema.runs).orderBy(desc(schema.runs.createdAt)).limit(100);
  return ctx.html(<RunsPage runs={runs} />);
});

app.get("/runs/:id", async (ctx) => {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, ctx.req.param("id")));
  if (!run) return ctx.notFound();
  return ctx.html(<RunDetailPage run={run} videoUrl={publicUrl(`${run.id}/run.webm`)} />);
});

app.get("/new", async (ctx) => {
  const cfg = await getConfig();
  const prs: OpenPr[] = [];
  for (const repo of cfg.repos) {
    for (const pr of await listOpenPrs(repo)) {
      prs.push({ repo, number: pr.number, title: pr.title });
    }
  }
  return ctx.html(<NewRunPage prs={prs} error={ctx.req.query("error")} />);
});

app.post("/runs", async (ctx) => {
  const form = await ctx.req.formData();
  const [repo, num] = String(form.get("pr")).split("#");
  try {
    const result = await startRun({
      repo: repo!,
      prNumber: Number(num),
      mode: form.get("mode") === "review" ? "review" : "test",
      previewUrl: String(form.get("previewUrl") ?? "") || undefined,
      freshPlan: form.get("freshPlan") === "on",
    });
    if (!result.started) return ctx.redirect(`/new?error=${encodeURIComponent(result.reason!)}`);
  } catch (err) {
    return ctx.redirect(`/new?error=${encodeURIComponent((err as Error).message)}`);
  }
  return ctx.redirect("/runs");
});

app.post("/runs/:id/retry", async (ctx) => {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, ctx.req.param("id")));
  if (!run) return ctx.notFound();
  if (run.status !== "failed" && run.status !== "error" && run.status !== "partial" && run.status !== "canceled") {
    return ctx.text("run is not retryable", 400);
  }
  const result = await startRun({
    repo: run.repo,
    prNumber: run.prNumber,
    mode: run.mode,
    previewUrl: run.previewUrl ?? undefined,
    freshPlan: run.freshPlan,
  });
  if (!result.started) return ctx.redirect(`/new?error=${encodeURIComponent(result.reason!)}`);
  return ctx.redirect("/runs");
});

app.post("/runs/:id/cancel", async (ctx) => {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, ctx.req.param("id")));
  if (!run) return ctx.notFound();
  if (run.status !== "queued" && run.status !== "starting" && run.status !== "running") {
    return ctx.text("run is not cancelable", 400);
  }
  // Best-effort stop: the job may already be dead (crashed worker, stuck row)
  // and marking the run canceled must still work.
  if (run.jobRunId) {
    try {
      await stopJob(run.jobRunId);
    } catch (err) {
      console.error(`stop job for run ${run.id}:`, err);
    }
  }
  await db
    .update(schema.runs)
    .set({
      status: "canceled",
      flavourText: run.flavourText ? finishRunFlavour(run.flavourText) : null,
      finishedAt: new Date(),
    })
    .where(eq(schema.runs.id, run.id));
  return ctx.redirect("/runs");
});

// Diagnostic: which credential rows decrypt under this instance's key.
// Exposes only metadata + a boolean, never plaintext.
app.get("/credcheck", async (ctx) => {
  const rows = await db.select().from(schema.credentials).orderBy(desc(schema.credentials.createdAt));
  const cfg = await getConfig();
  return ctx.json(
    rows.map((row) => {
      let decrypts = true;
      try {
        decrypt(row.encrypted);
      } catch {
        decrypts = false;
      }
      return {
        id: row.id,
        providerId: row.providerId,
        kind: row.kind,
        createdAt: row.createdAt,
        decrypts,
        active: cfg.activeModel?.credentialId === row.id,
      };
    }),
  );
});

// Diagnostic: runtime key fingerprint (not the key), for comparison with the worker's boot log.
app.get("/keyfp", (ctx) =>
  ctx.text(createHash("sha256").update(process.env.TOKEN_ENC_KEY!).digest("hex").slice(0, 8)),
);

app.get("/models", async (ctx) => {
  const cfg = await getConfig();
  const creds = await db.select().from(schema.credentials).orderBy(desc(schema.credentials.createdAt));
  return ctx.html(
    <ModelsPage
      providers={Object.values(PROVIDERS)}
      creds={creds}
      active={cfg.activeModel}
      notice={ctx.req.query("notice")}
    />,
  );
});

app.post("/models/credential", async (ctx) => {
  const form = await ctx.req.formData();
  const providerId = String(form.get("providerId"));
  getProvider(providerId); // validate
  const apiKey = String(form.get("apiKey"));
  // azure/bedrock creds are multi-field; their adapters JSON.parse the blob.
  let secret = apiKey;
  if (providerId === "azure") {
    secret = JSON.stringify({ apiKey, resourceName: String(form.get("resourceName")) });
  } else if (providerId === "bedrock") {
    secret = JSON.stringify({
      accessKeyId: apiKey,
      secretAccessKey: String(form.get("secretAccessKey")),
      region: String(form.get("region")),
    });
  }
  await db.insert(schema.credentials).values({
    providerId,
    kind: "api_key",
    encrypted: encrypt(secret),
  });
  return ctx.redirect("/models?notice=API+key+saved");
});

app.post("/models/active", async (ctx) => {
  const form = await ctx.req.formData();
  const [providerId, ...rest] = String(form.get("model")).split("/");
  await updateConfig({
    activeModel: {
      providerId: providerId!,
      model: rest.join("/"),
      credentialId: String(form.get("credentialId")),
    },
  });
  return ctx.redirect("/models?notice=Active+model+updated");
});

app.get("/oauth/start", (ctx) => {
  const provider = getProvider(ctx.req.query("provider") ?? "");
  if (!provider.oauth) return ctx.text("provider has no oauth", 400);
  const pkce = generatePkce();
  // Anthropic's authorize endpoint rejects the flow with "Invalid request
  // format" unless state is the PKCE verifier (matches pi and Claude Code).
  const state = pkce.verifier;
  setOAuthState(ctx, { provider: provider.id, state, verifier: pkce.verifier });
  const url = authorizeUrl(provider.oauth, pkce.challenge, state);
  if (provider.oauth.codePaste) {
    return ctx.html(<OAuthPastePage provider={provider.id} authorizeUrl={url} />);
  }
  return ctx.redirect(url);
});

async function storeOAuthCredential(providerId: string, pasted: string, verifier: string) {
  const provider = getProvider(providerId);
  const tokens = await exchangeCode(provider.oauth!, pasted, verifier);
  await db.insert(schema.credentials).values({
    providerId,
    kind: "oauth",
    encrypted: encrypt(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })),
    expiresAt: tokens.expiresAt,
  });
}

// Redirect-flow providers land here; code-paste providers go through /oauth/paste.
app.get("/oauth/callback", async (ctx) => {
  const oauthState = getOAuthState(ctx);
  if (!oauthState || oauthState.state !== ctx.req.query("state")) return ctx.text("bad oauth state", 400);
  await storeOAuthCredential(oauthState.provider, ctx.req.query("code") ?? "", oauthState.verifier);
  return ctx.redirect("/models?notice=OAuth+connected");
});

app.post("/oauth/paste", async (ctx) => {
  const oauthState = getOAuthState(ctx);
  if (!oauthState) return ctx.text("oauth session expired — start again", 400);
  const form = await ctx.req.formData();
  await storeOAuthCredential(oauthState.provider, String(form.get("code")), oauthState.verifier);
  return ctx.redirect("/models?notice=OAuth+connected");
});

app.get("/chat", (ctx) => ctx.html(<ChatPage />));

app.post("/chat", async (ctx) => {
  const form = await ctx.req.formData();
  const repo = String(form.get("repo"));
  const prNumber = String(form.get("prNumber"));
  const question = String(form.get("question"));
  const answer = await answerQuestion({ repo, prNumber: Number(prNumber), question });
  return ctx.html(<ChatPage repo={repo} prNumber={prNumber} question={question} answer={answer} />);
});

app.get("/learnings", async (ctx) => {
  const cfg = await getConfig();
  const learnings = await db.select().from(schema.learnings).orderBy(desc(schema.learnings.createdAt));
  return ctx.html(<LearningsPage repos={cfg.repos} learnings={learnings} notice={ctx.req.query("notice")} />);
});

app.post("/learnings", async (ctx) => {
  const form = await ctx.req.formData();
  const cfg = await getConfig();
  const existing = await db.select().from(schema.learnings);
  for (const learning of existing) {
    const field = form.get(`learning_${learning.id}`);
    if (field === null) continue;
    const text = String(field).trim().slice(0, LEARNING_MAX_CHARS);
    if (!text) {
      await db.delete(schema.learnings).where(eq(schema.learnings.id, learning.id));
    } else if (text !== learning.text) {
      await db.update(schema.learnings).set({ text }).where(eq(schema.learnings.id, learning.id));
    }
  }
  for (const repo of cfg.repos) {
    const text = String(form.get(`new_${repo}`) ?? "").trim().slice(0, LEARNING_MAX_CHARS);
    if (text) await addLearning({ repo, text });
  }
  return ctx.redirect("/learnings?notice=Saved");
});

app.get("/export", (ctx) => ctx.html(<ExportPage notice={ctx.req.query("notice")} />));

app.get("/api/export", async (ctx) => {
  const before = new Date(ctx.req.query("before") ?? "");
  if (Number.isNaN(before.getTime())) return ctx.text("invalid date", 400);
  ctx.header("content-type", "application/zip");
  ctx.header(
    "content-disposition",
    `attachment; filename="croft-export-${before.toISOString().slice(0, 10)}.zip"`,
  );
  return ctx.body(await exportZip(before));
});

app.post("/api/purge", async (ctx) => {
  const form = await ctx.req.formData();
  if (form.get("confirm") !== "delete") {
    return ctx.redirect("/export?notice=Purge+not+confirmed+—+type+delete");
  }
  const before = new Date(String(form.get("before")));
  if (Number.isNaN(before.getTime())) return ctx.text("invalid date", 400);
  const deleted = await purge(before);
  return ctx.redirect(`/export?notice=Deleted+${deleted}+runs`);
});

app.get("/settings", async (ctx) => {
  return ctx.html(<SettingsPage cfg={await getConfig()} notice={ctx.req.query("notice")} />);
});

app.post("/settings", async (ctx) => {
  const form = await ctx.req.formData();
  const cfg = await getConfig();
  const repos = String(form.get("repos") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const previewLogins: Record<string, PreviewLogin[]> = {};
  const repoContext: Record<string, string> = {};
  for (const repo of repos) {
    const context = String(form.get(`context_${repo}`) ?? "").trim();
    if (context) repoContext[repo] = context;
    const existing = cfg.previewLogins[repo] ?? [];
    const logins: PreviewLogin[] = [];
    // Rows are rendered as existing logins (in order) plus one blank row, so
    // row index maps to existing[index]. An emptied username deletes the row.
    for (let index = 0; form.get(`login_user_${repo}_${index}`) !== null; index++) {
      const username = String(form.get(`login_user_${repo}_${index}`)).trim();
      if (!username) continue;
      const password = String(form.get(`login_pass_${repo}_${index}`) ?? "");
      const label = String(form.get(`login_label_${repo}_${index}`) ?? "").trim() || undefined;
      const loginUrl = String(form.get(`login_url_${repo}_${index}`) ?? "").trim() || undefined;
      const encryptedPassword = password ? encrypt(password) : existing[index]?.encryptedPassword;
      if (encryptedPassword) logins.push({ label, username, loginUrl, encryptedPassword });
    }
    if (logins.length > 0) previewLogins[repo] = logins;
  }
  const toolCallCap = Number(form.get("toolCallCap"));
  await updateConfig({
    webhooksEnabled: form.get("webhooksEnabled") === "on",
    toolCallCap: Number.isInteger(toolCallCap) && toolCallCap > 0 ? toolCallCap : cfg.toolCallCap,
    repos,
    autoReviewRepos: repos.filter((repo) => form.get(`autoreview_${repo}`) === "on"),
    allowedUsers: String(form.get("allowedUsers") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    previewLogins,
    repoContext,
    findingsPing: String(form.get("findingsPing") ?? "").trim().replace(/^@/, "") || null,
    findingsPingAuthor: form.get("findingsPingAuthor") === "on",
    agentFixContext: form.get("agentFixContext") === "on",
  });
  return ctx.redirect("/settings?notice=Saved");
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`croft web listening on :${port}`);
  // Diagnostic: compare against the worker's boot log and GET /keyfp.
  console.log("TOKEN_ENC_KEY fp", createHash("sha256").update(process.env.TOKEN_ENC_KEY!).digest("hex").slice(0, 8));
});

setInterval(() => {
  reapDeadRuns().catch((err) => console.error("watchdog", err));
}, 60_000);
