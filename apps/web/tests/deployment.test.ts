import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Webhooks } from "@octokit/webhooks";
import { db, decrypt, eventWriter, getConfig, listEvents, schema, type DashboardRole } from "@croft/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sessionUser, setOAuthState, setSession } from "../src/session";
import { GET as loginCallback } from "../src/app/login/callback/route";

type RunInsert = typeof schema.runs.$inferInsert;

const origin = z.url().parse(process.env.WEB_TEST_URL);
const database = new URL(z.url().parse(process.env.DATABASE_URL));
assert.equal(new URL(origin).hostname, "127.0.0.1");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/croft_next_test");
const users: Record<DashboardRole, string> = { admin: "122644200", member: "1", user: "2" };
const runIds = Array.from({ length: 26 }, () => randomUUID());
const runId = z.uuid().parse(runIds[0]);

function request(path: string, role: DashboardRole | null = "admin", init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (role) {
    const response = new Response();
    setSession(response, users[role]);
    headers.set("cookie", response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; "));
  }
  return fetch(origin + path, { ...init, headers, redirect: "manual" });
}

function submit(path: string, fields: Record<string, string>) {
  return request(path, "admin", { method: "POST", headers: { origin }, body: new URLSearchParams(fields) });
}

before(async () => {
  await db.insert(schema.dashboardUsers).values([
    { githubId: users.member, username: "test-member", role: "member" },
    { githubId: users.user, username: "test-user", role: "user" },
  ]);
  await db.insert(schema.runs).values(runIds.map<RunInsert>((id, index) => ({
    id, repo: "smoke/repo", prNumber: index + 1, mode: "test", providerId: "openai", model: "test-model",
    credentialId: randomUUID(), createdAt: new Date(1_700_000_000_000 + index * 1000), flavourText: "I'm inspecting this PR",
    status: index === 25 ? "passed" : "queued",
  })));
});

after(async () => { await db.$client.end(); });

test("anonymous requests, legacy sessions, role changes, and denied pages work through the image", async () => {
  const anonymous = await request("/runs", null, { headers: { "x-croft-role": "admin" } });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("location"), `${origin}/login`);
  for (const role of ["user", "member"] as const) {
    const denied = await request("/settings", role);
    assert.equal(denied.status, 403);
    assert.ok((await denied.text()).includes("This content isn’t available"));
    assert.match(denied.headers.get("cache-control") ?? "", /private/);
  }
  const session = new Response();
  setSession(session, users.member);
  const headers = { cookie: session.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") };
  const member = await request("/runs", null, { headers });
  const body = await member.text();
  assert.equal(member.status, 200);
  assert.ok(!body.includes('href="/settings"'));
  assert.ok(!body.includes('/cancel"'));
  await db.update(schema.dashboardUsers).set({ role: "user" }).where(eq(schema.dashboardUsers.githubId, users.member));
  assert.equal((await request("/runs", null, { headers })).status, 403);
  await db.update(schema.dashboardUsers).set({ role: "member" }).where(eq(schema.dashboardUsers.githubId, users.member));
});

test("all dashboard pages, pagination, and HEAD requests render without external services", async () => {
  for (const path of ["/chat", "/export", "/models", "/settings", "/learnings", "/users", "/new", `/runs/${runId}`]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("cache-control") ?? "", /private/);
    assert.ok((await response.text()).includes("Croft"), path);
  }
  const first = await (await request("/runs")).text();
  const second = await (await request("/runs?page=2")).text();
  const third = await (await request("/runs?page=3")).text();
  assert.equal(first.match(/href="https:\/\/github.com\/smoke\/repo\/pull\//g)?.length, 12);
  assert.equal(second.match(/href="https:\/\/github.com\/smoke\/repo\/pull\//g)?.length, 12);
  assert.equal(third.match(/href="https:\/\/github.com\/smoke\/repo\/pull\//g)?.length, 2);
  assert.ok(first.includes('href="/runs?status=all&amp;page=2"'));
  assert.ok(!third.includes('href="/runs?status=all&amp;page=4"'));
  const passed = await (await request("/runs?status=passed&page=99")).text();
  assert.equal(passed.match(/href="https:\/\/github.com\/smoke\/repo\/pull\//g)?.length, 1);
  assert.ok(passed.includes('href="https://github.com/smoke/repo/pull/26"'));
  assert.ok(!passed.includes('href="/runs?status=passed&amp;page=2"'));
  const empty = await (await request("/runs?status=failed")).text();
  assert.ok(empty.includes("No runs match this filter."));
  const head = await request("/runs", "member", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("run logs decrypt only for admins, paginate, and stay scoped to the run", async () => {
  const emit = eventWriter(runId);
  for (let seq = 1; seq <= 51; seq++) await emit("assistant_text", { text: `event-${String(seq).padStart(2, "0")}-end` });
  const stored = await db.select().from(schema.events).where(eq(schema.events.runId, runId));
  assert.equal(stored.length, 51);
  assert.ok(stored.every((event) => typeof event.payload === "string"));
  assert.ok(!JSON.stringify(stored).includes("event-01-end"));
  assert.deepEqual((await listEvents(runId))[0]?.payload, { text: "event-01-end" });
  await db.insert(schema.events).values({ runId, seq: 52, type: "assistant_text", payload: { text: "legacy-event" } });
  const otherRunId = z.uuid().parse(runIds[1]);
  await eventWriter(otherRunId)("assistant_text", { text: "other-run-event" });
  const path = `/runs/${runId}/logs`;
  const response = await request(path);
  const latest = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(latest.includes("legacy-event"));
  assert.ok(latest.includes("event-51-end"));
  assert.ok(!latest.includes("event-01-end"));
  assert.ok(!latest.includes("other-run-event"));
  assert.ok(latest.includes(`href="${path}?before=3"`));
  const older = await (await request(`${path}?before=3`)).text();
  assert.ok(older.includes("event-01-end"));
  assert.ok(!older.includes("event-51-end"));
  assert.ok(!older.includes("Older events"));
  for (const role of ["member", "user"] as const) {
    const denied = await request(path, role);
    assert.equal(denied.status, 403);
    assert.ok(!(await denied.text()).includes("legacy-event"));
  }
  assert.equal((await request(path, null)).status, 302);
  assert.equal((await request(`${path}?before=bad`)).status, 404);
  assert.equal((await request(`/runs/${randomUUID()}/logs`)).status, 404);
});

test("standalone assets and the existing API docs ship in the image", async () => {
  const css = await request("/styles.css", null);
  assert.equal(css.status, 200);
  assert.ok((await css.text()).includes("--sidebar: #e8eee3"));
  const favicon = await request("/favicon.ico", null);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get("content-type"), "image/png");
  assert.ok((await favicon.arrayBuffer()).byteLength > 0);
  const body = await (await request("/chat")).text();
  const script = body.match(/src="([^\"]+\.js[^\"]*)"/);
  assert.ok(script?.[1]);
  assert.equal((await request(script[1], null)).status, 200);
  assert.equal((await request("/api/docs", "member")).status, 403);
  assert.ok((await (await request("/api/docs")).text()).includes("swagger-ui-dist@5.32.14"));
});

test("native form posts preserve CSRF rejection, redirects, and mutation results", async () => {
  const blocked = await request("/settings", "admin", { method: "POST", body: new URLSearchParams() });
  assert.equal(blocked.status, 403);
  assert.equal(await blocked.text(), "Forbidden");
  assert.equal((await submit("/api/forms/settings", {})).status, 404);
  const noModel = await submit("/runs", { pr: "smoke/repo#1", mode: "review" });
  assert.equal(noModel.status, 302);
  assert.equal(noModel.headers.get("location"), "/new?error=No%20active%20model%20configured%20%E2%80%94%20set%20one%20on%20the%20Models%20page.");
  const saved = await submit("/settings", {
    repos: "smoke/repo", toolCallCap: "75",
    "login_user_smoke/repo_0": "preview-user", "login_pass_smoke/repo_0": "preview-password",
  });
  assert.equal(saved.status, 302);
  assert.equal(saved.headers.get("location"), "/settings?notice=Saved");
  const cfg = await getConfig();
  assert.deepEqual(cfg.repos, ["smoke/repo"]);
  assert.equal(cfg.toolCallCap, 75);
  const password = z.string().parse(cfg.previewLogins["smoke/repo"]?.[0]?.encryptedPassword);
  assert.equal(decrypt(password), "preview-password");
  const settings = await (await request("/settings")).text();
  assert.ok(!settings.includes(password));
  assert.ok(!settings.includes("preview-password"));
  const invalidUser = await submit("/users", { username: "!", role: "member" });
  assert.equal(invalidUser.headers.get("location"), "/users?error=1");
  assert.equal((await submit(`/runs/${runId}/cancel`, {})).status, 302);
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  assert.equal(run?.status, "canceled");
  assert.ok(run?.finishedAt);
  assert.equal((await submit(`/runs/${runId}/cancel`, {})).status, 400);
});

test("credential and learning forms write the same encrypted and editable data", async () => {
  assert.equal((await submit("/models/credential", { providerId: "openai", apiKey: "model-key" })).status, 302);
  const [credential] = await db.select().from(schema.credentials);
  assert.ok(credential);
  assert.equal(decrypt(credential.encrypted), "model-key");
  const selected = await submit("/models/active", { model: "openai/test-model", credentialId: credential.id });
  assert.equal(selected.headers.get("location"), "/models?notice=Active+model+updated");
  assert.equal((await getConfig()).activeModel?.credentialId, credential.id);
  assert.equal((await submit("/learnings", { "new_smoke/repo": "  Remember this rule.  " })).status, 302);
  const [learning] = await db.select().from(schema.learnings);
  assert.ok(learning);
  assert.equal(learning.text, "Remember this rule.");
  await submit("/learnings", { [`learning_${learning.id}`]: "" });
  assert.deepEqual(await db.select().from(schema.learnings), []);
});

test("activity, OAuth, and export endpoints keep their authentication and response contracts", async () => {
  assert.equal((await request("/api/v1/activity", null)).status, 401);
  const activity = await request("/api/v1/activity", null, { headers: { "X-API-Key": "image-test-key" } });
  assert.equal(activity.status, 200);
  assert.equal(z.object({ prNumber: z.number() }).parse(await activity.json()).prNumber, 26);
  const login = await request("/login", null);
  assert.equal(login.status, 302);
  assert.equal(new URL(z.string().parse(login.headers.get("location"))).hostname, "github.com");
  assert.ok(login.headers.getSetCookie().some((cookie) => cookie.startsWith("croft_oauth=")));
  const exported = await request("/api/export?before=1970-01-01");
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("content-type"), "application/zip");
  const zip = Buffer.from(await exported.arrayBuffer());
  assert.equal(zip.subarray(0, 2).toString(), "PK");
  assert.ok(zip.includes("runs.jsonl"));
  assert.ok(zip.includes("events.jsonl"));
  assert.equal((await submit("/api/purge", {})).headers.get("location"), "/export?notice=Purge+not+confirmed+%E2%80%94+type+delete");
});

test("OAuth callbacks preserve existing roles and register new users with restricted access", async (context) => {
  for (const githubId of [...Object.values(users), "3"]) {
    const role = githubId === "3" ? "user" : (await db.select().from(schema.dashboardUsers)
      .where(eq(schema.dashboardUsers.githubId, githubId)))[0]?.role;
    assert.ok(role);
    for (const username of ["login-name", "renamed-login"]) {
      const github = context.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
        if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "test-token" });
        assert.equal(url, "https://api.github.com/user");
        return Response.json({ id: Number(githubId), login: username });
      });
      const state = new Response();
      setOAuthState(state, { provider: "github-login", state: "test-state", verifier: "" });
      const response = await loginCallback(new Request(`${origin}/login/callback?code=test-code&state=test-state`, {
        headers: { cookie: state.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") },
      }), undefined);
      github.mock.restore();
      assert.equal(response.status, 302, githubId);
      assert.equal(response.headers.get("location"), "/runs");
      assert.equal(sessionUser(new Request(origin, {
        headers: { cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") },
      })), githubId);
      const [saved] = await db.select().from(schema.dashboardUsers).where(eq(schema.dashboardUsers.githubId, githubId));
      assert.deepEqual(saved, { githubId, username, role });
    }
  }
});

test("large signed webhooks reach verification intact and delivery IDs remain idempotent", async () => {
  const verifier = new Webhooks({ secret: "image-test-secret" });
  const delivery = randomUUID();
  const body = JSON.stringify({ padding: "x".repeat(11 * 1024 * 1024) });
  const headers = { "x-github-delivery": delivery, "x-github-event": "ping", "x-hub-signature-256": await verifier.sign(body) };
  const first = await request("/api/webhooks/github", null, { method: "POST", headers, body });
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "ignored");
  const smallBody = "{}";
  headers["x-hub-signature-256"] = await verifier.sign(smallBody);
  const second = await request("/api/webhooks/github", null, { method: "POST", headers, body: smallBody });
  assert.equal(second.status, 200);
  assert.equal(await second.text(), "duplicate delivery");
});
