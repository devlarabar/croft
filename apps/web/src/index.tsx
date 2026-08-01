import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  authorizeUrl,
  db,
  decrypt,
  encrypt,
  exchangeCode,
  generatePkce,
  getConfig,
  getProvider,
  listOpenPrs,
  PROVIDERS,
  publicUrl,
  schema,
  updateConfig,
} from "@croft/core";
import type { PreviewLogin } from "@croft/core";
import { exportZip, purge } from "./export.js";
import {
  ChatPage,
  ExportPage,
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
import {
  getOAuthState,
  githubExchange,
  githubLoginUrl,
  newState,
  requireAuth,
  setOAuthState,
  setSession,
} from "./session.js";
import { handleWebhook } from "./webhook.js";

const app = new Hono();

// Single-user dashboard: show the real error instead of a bare 500.
app.onError((err, c) => {
  console.error(err);
  return c.text(`${err.message}\n\n${err.stack ?? ""}`, 500);
});

// Public endpoints; everything else requires the dashboard session.
app.post("/api/webhooks/github", handleWebhook);
app.get("/login", (c) => {
  const state = newState();
  setOAuthState(c, { provider: "github-login", state, verifier: "" });
  return c.redirect(githubLoginUrl(state));
});
app.get("/login/callback", async (c) => {
  const st = getOAuthState(c);
  if (!st || st.provider !== "github-login" || st.state !== c.req.query("state")) {
    return c.text("bad oauth state", 400);
  }
  const login = await githubExchange(c.req.query("code") ?? "");
  if (!login || login !== process.env.DASHBOARD_USER) return c.text("forbidden", 403);
  setSession(c, login);
  return c.redirect("/runs");
});

app.use("*", requireAuth);

app.get("/", (c) => c.redirect("/runs"));

app.get("/runs", async (c) => {
  const runs = await db.select().from(schema.runs).orderBy(desc(schema.runs.createdAt)).limit(100);
  return c.html(<RunsPage runs={runs} />);
});

app.get("/runs/:id", async (c) => {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, c.req.param("id")));
  if (!run) return c.notFound();
  return c.html(<RunDetailPage run={run} videoUrl={publicUrl(`${run.id}/run.webm`)} />);
});

app.get("/new", async (c) => {
  const cfg = await getConfig();
  const prs: OpenPr[] = [];
  for (const repo of cfg.repos) {
    for (const pr of await listOpenPrs(repo)) {
      prs.push({ repo, number: pr.number, title: pr.title });
    }
  }
  return c.html(<NewRunPage prs={prs} error={c.req.query("error")} />);
});

app.post("/runs", async (c) => {
  const form = await c.req.formData();
  const [repo, num] = String(form.get("pr")).split("#");
  try {
    const result = await startRun({
      repo: repo!,
      prNumber: Number(num),
      mode: "test",
      previewUrl: String(form.get("previewUrl") ?? "") || undefined,
    });
    if (!result.started) return c.redirect(`/new?error=${encodeURIComponent(result.reason!)}`);
  } catch (err) {
    return c.redirect(`/new?error=${encodeURIComponent((err as Error).message)}`);
  }
  return c.redirect("/runs");
});

app.post("/runs/:id/retry", async (c) => {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, c.req.param("id")));
  if (!run) return c.notFound();
  if (run.status !== "failed" && run.status !== "error") return c.text("run is not failed", 400);
  const result = await startRun({
    repo: run.repo,
    prNumber: run.prNumber,
    mode: run.mode,
    previewUrl: run.previewUrl ?? undefined,
  });
  if (!result.started) return c.redirect(`/new?error=${encodeURIComponent(result.reason!)}`);
  return c.redirect("/runs");
});

// Diagnostic: which credential rows decrypt under this instance's key.
// Exposes only metadata + a boolean, never plaintext.
app.get("/credcheck", async (c) => {
  const rows = await db.select().from(schema.credentials).orderBy(desc(schema.credentials.createdAt));
  const cfg = await getConfig();
  return c.json(
    rows.map((r) => {
      let decrypts = true;
      try {
        decrypt(r.encrypted);
      } catch {
        decrypts = false;
      }
      return {
        id: r.id,
        providerId: r.providerId,
        kind: r.kind,
        createdAt: r.createdAt,
        decrypts,
        active: cfg.activeModel?.credentialId === r.id,
      };
    }),
  );
});

// Diagnostic: runtime key fingerprint (not the key), for comparison with the worker's boot log.
app.get("/keyfp", (c) =>
  c.text(createHash("sha256").update(process.env.TOKEN_ENC_KEY!).digest("hex").slice(0, 8)),
);

app.get("/models", async (c) => {
  const cfg = await getConfig();
  const creds = await db.select().from(schema.credentials).orderBy(desc(schema.credentials.createdAt));
  return c.html(
    <ModelsPage
      providers={Object.values(PROVIDERS)}
      creds={creds}
      active={cfg.activeModel}
      notice={c.req.query("notice")}
    />,
  );
});

app.post("/models/credential", async (c) => {
  const form = await c.req.formData();
  const providerId = String(form.get("providerId"));
  getProvider(providerId); // validate
  await db.insert(schema.credentials).values({
    providerId,
    kind: "api_key",
    encrypted: encrypt(String(form.get("apiKey"))),
  });
  return c.redirect("/models?notice=API+key+saved");
});

app.post("/models/active", async (c) => {
  const form = await c.req.formData();
  const [providerId, ...rest] = String(form.get("model")).split("/");
  await updateConfig({
    activeModel: {
      providerId: providerId!,
      model: rest.join("/"),
      credentialId: String(form.get("credentialId")),
    },
  });
  return c.redirect("/models?notice=Active+model+updated");
});

app.get("/oauth/start", (c) => {
  const provider = getProvider(c.req.query("provider") ?? "");
  if (!provider.oauth) return c.text("provider has no oauth", 400);
  const pkce = generatePkce();
  // Anthropic's authorize endpoint rejects the flow with "Invalid request
  // format" unless state is the PKCE verifier (matches pi and Claude Code).
  const state = pkce.verifier;
  setOAuthState(c, { provider: provider.id, state, verifier: pkce.verifier });
  const url = authorizeUrl(provider.oauth, pkce.challenge, state);
  if (provider.oauth.codePaste) {
    return c.html(<OAuthPastePage provider={provider.id} authorizeUrl={url} />);
  }
  return c.redirect(url);
});

async function storeOAuthCredential(providerId: string, pasted: string, verifier: string) {
  const provider = getProvider(providerId);
  const t = await exchangeCode(provider.oauth!, pasted, verifier);
  await db.insert(schema.credentials).values({
    providerId,
    kind: "oauth",
    encrypted: encrypt(JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken })),
    expiresAt: t.expiresAt,
  });
}

// Redirect-flow providers land here; code-paste providers go through /oauth/paste.
app.get("/oauth/callback", async (c) => {
  const st = getOAuthState(c);
  if (!st || st.state !== c.req.query("state")) return c.text("bad oauth state", 400);
  await storeOAuthCredential(st.provider, c.req.query("code") ?? "", st.verifier);
  return c.redirect("/models?notice=OAuth+connected");
});

app.post("/oauth/paste", async (c) => {
  const st = getOAuthState(c);
  if (!st) return c.text("oauth session expired — start again", 400);
  const form = await c.req.formData();
  await storeOAuthCredential(st.provider, String(form.get("code")), st.verifier);
  return c.redirect("/models?notice=OAuth+connected");
});

app.get("/chat", (c) => c.html(<ChatPage />));

app.post("/chat", async (c) => {
  const form = await c.req.formData();
  const repo = String(form.get("repo"));
  const prNumber = String(form.get("prNumber"));
  const question = String(form.get("question"));
  const answer = await answerQuestion(repo, Number(prNumber), question);
  return c.html(<ChatPage repo={repo} prNumber={prNumber} question={question} answer={answer} />);
});

app.get("/export", (c) => c.html(<ExportPage notice={c.req.query("notice")} />));

app.get("/api/export", async (c) => {
  const before = new Date(c.req.query("before") ?? "");
  if (Number.isNaN(before.getTime())) return c.text("invalid date", 400);
  c.header("content-type", "application/zip");
  c.header(
    "content-disposition",
    `attachment; filename="croft-export-${before.toISOString().slice(0, 10)}.zip"`,
  );
  return c.body(await exportZip(before));
});

app.post("/api/purge", async (c) => {
  const form = await c.req.formData();
  if (form.get("confirm") !== "delete") {
    return c.redirect("/export?notice=Purge+not+confirmed+—+type+delete");
  }
  const before = new Date(String(form.get("before")));
  if (Number.isNaN(before.getTime())) return c.text("invalid date", 400);
  const n = await purge(before);
  return c.redirect(`/export?notice=Deleted+${n}+runs`);
});

app.get("/settings", async (c) => {
  return c.html(<SettingsPage cfg={await getConfig()} notice={c.req.query("notice")} />);
});

app.post("/settings", async (c) => {
  const form = await c.req.formData();
  const cfg = await getConfig();
  const repos = String(form.get("repos") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const previewLogins: Record<string, PreviewLogin> = {};
  for (const repo of repos) {
    const username = String(form.get(`login_user_${repo}`) ?? "").trim();
    const password = String(form.get(`login_pass_${repo}`) ?? "");
    const loginUrl = String(form.get(`login_url_${repo}`) ?? "").trim() || undefined;
    const existing = cfg.previewLogins[repo];
    if (username && password) {
      previewLogins[repo] = { username, loginUrl, encryptedPassword: encrypt(password) };
    } else if (existing && username) {
      previewLogins[repo] = { ...existing, username, loginUrl };
    } else if (existing) {
      previewLogins[repo] = existing;
    }
  }
  await updateConfig({
    webhooksEnabled: form.get("webhooksEnabled") === "on",
    repos,
    allowedUsers: String(form.get("allowedUsers") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    previewLogins,
  });
  return c.redirect("/settings?notice=Saved");
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`croft web listening on :${port}`);
  // Diagnostic: compare against the worker's boot log and GET /keyfp.
  console.log("TOKEN_ENC_KEY fp", createHash("sha256").update(process.env.TOKEN_ENC_KEY!).digest("hex").slice(0, 8));
});
