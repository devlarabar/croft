# Croft — Plan

Croft is a self-hosted agent that tests GitHub PRs against their preview deployments
(screenshots + screen recordings, executing the PR's test plan), answers questions about
PR changes conversationally, and — as a stretch goal — reviews PRs for bugs, breakage,
and DRY violations.

Single-user. Hosted on Scaleway (work credits), designed to cost ~€0/month at idle.
No provider-specific AI SDKs: hand-rolled LLM client and OAuth adapters.

## Architecture

Three components:

1. **Control plane + UI** — one Next.js (or Hono + static UI) app on a Scaleway
   Serverless Container. Owns state: runs, event log, credentials, model config,
   GitHub webhooks, dashboard.
2. **Agent runtime** — ephemeral Scaleway Serverless Jobs. Each run = one container
   (Playwright + agent loop) started via the Jobs API with per-run env vars.
3. **Backing services** — Serverless SQL Database (Postgres), Object Storage
   (S3-compatible, artifacts), Container Registry (images).

### Run lifecycle

1. Trigger: `@croft test` PR comment, or "Run" in the UI — always manual; Croft
   never starts a run on its own. Webhook-based triggers (comments, incl.
   `@croft <question>` Q&A) are gated by a `config.webhooksEnabled` toggle — when
   off, the webhook endpoint still ACKs with 200 but takes no action;
   UI-initiated runs are unaffected.
   Comment triggers are honoured only when the commenter's `author_association`
   is OWNER, MEMBER or COLLABORATOR, **or** their username is on
   `config.allowedUsers` — and never on PRs from forks. Anyone else could
   otherwise spend LLM budget, and the agent reads attacker-controllable PR
   text while holding GitHub write tools (prompt injection).
   GitHub redelivers webhooks; each delivery's `X-GitHub-Delivery` id is
   recorded and repeats are ignored, so a redelivered comment can't start a
   duplicate run.
2. The control plane resolves the preview URL before starting anything —
   discovery is orchestration, not agent work. It searches the PR's comments —
   comments only, never the PR description — for one containing "preview
   deployment" and a link (case-insensitive; first URL in that comment wins).
   It checks once — never waits, never polls. A preview URL supplied in the UI
   wins over discovery. If no URL is found, Croft posts a comment on the PR
   saying it found no preview URL and **no job is started** — nothing billed.
3. Control plane starts the worker job with `RUN_ID`, `PR_NUMBER`, `PREVIEW_URL`
   — always all three, one code path. The worker performs no discovery.
4. Worker runs the agent loop; every tool call/result is written as an event row
   directly to Postgres (Drizzle in the worker — there is no event-ingestion API;
   the worker writes events, the control plane only reads them), artifacts
   uploaded to Object Storage under
   `<runId>/<filename>` with an explicit correct `ContentType` (`image/png`,
   `video/webm`) — GitHub's Camo proxy silently refuses to render images served
   as `application/octet-stream`.
5. On finish: PR comment with summary, per-step pass/fail, screenshots embedded
   inline via their public object URLs, and a link to the run's page in Croft's
   UI to watch the video; check-run status.

### Modes

- **Test mode** (core): browser tools against the preview deployment.
  - **Test plan extraction:** find a `## Test plan` header in the PR body
    (case-insensitive). The plan is everything under that header **until the next
    header of the same or higher level** (`##` or `#`) or end of body — nothing
    else from the description is included; lower-level headers (`###`+) inside the
    section belong to the plan. Passed verbatim into the system prompt.
  - **Fallback — generated plan:** if no such section exists, Croft generates one
    from the PR diff using the vendored test-plan skill (`skills/test-plan.md`,
    genericized to take the diff/description as input and embedded verbatim in
    the prompt): plain-English,
    observable, user-facing numbered steps; golden path first, then 1–2 edge cases;
    skip untestable changes (refactors, logging, dep bumps); no file paths,
    internal names, or devtools steps. The generated plan is recorded as a run
    event and included in the report so it's visible what was tested.
  - If the diff yields nothing testable, the run reports that instead of inventing
    steps.
- **Q&A mode**: `@croft <question>` comments and a UI chat pane. No browser, no job —
  a direct LLM call in the control plane with context = PR diff + description + the
  last run's event log/report.
- **Review mode** (stretch): no browser. Job checks out the PR branch; tools are
  `read_file`/`grep`/`glob` + the diff + a `submit_review` tool mapping to
  GitHub's review API (file/line anchored). Deliberately no `bash`: a constrained
  toolset keeps reviews predictable and is safer on attacker-influenced branches.
  Separate prompt from test mode.

### Agent worker tools

- `browser_*` — Playwright: navigate, click, type, screenshot (fed back to the model
  as an image; only vision-capable models are selectable for test mode).
  Screenshots sent to the model are downscaled and JPEG-compressed — vision
  tokens are the dominant per-run cost; full-resolution PNGs go only to Object
  Storage for the report. Video: the
  whole run is recorded via the context-level `recordVideo` option (it can't be
  toggled mid-session — Playwright only finalizes the file when the context closes),
  and the file is uploaded at run end.
  `recordVideo.dir` must **not** sit under `/tmp`: Jobs run under gVisor, where `/tmp`
  is memory-backed and counts against the job's 2 GB. Write to `/artifacts` in the
  image's own filesystem, record at 1280×720, upload and delete at run end.
- `github_*` — read diff/files, post comment, post review.
- `read_file` / `grep` / `glob` — on a checkout of the PR branch (review mode);
  no `bash`.
- `report` — structured pass/fail per test-plan step.

Failure semantics: GitHub API and S3 calls retry ×3 with backoff (both are
idempotent here — comment create is the exception, so create it last, once).
DB writes retry only on transient/connection errors. LLM calls retry once,
transport/429 errors only. Browser actions never auto-retry: the model sees
the failure and decides — blind replays re-click buttons.

The system prompt treats all run inputs as untrusted: page content, PR text,
comments, and screenshots are data, never instructions — in test mode the preview
runs the PR's own code, so the rendered page itself can carry injected
instructions regardless of who triggered the run.

Don't generalize the browser agent early: hardcode assumptions about our app's preview
deployments (login flow, URL pattern) and generalize only when it hurts.

## LLM layer (hand-rolled, no provider SDKs; adapter strategy)

Providers are code, not data: each is an adapter class registered in a code-level
registry. The DB stores only runtime state — secrets and the current selection.
Both auth methods ship at launch.

```ts
interface ProviderAdapter {
  id: string;                    // registry key
  models: string[];              // selectable in the UI
  oauth?: {                      // present iff the provider supports OAuth
    authorizeUrl: string; tokenUrl: string; clientId: string; scopes: string[];
    redirectUri: string;         // our /oauth/callback, or the provider's own
                                 // fixed callback for code-paste flows (see below)
  };
  // Owns base URL, wire format (request/response JSON + SSE parsing),
  // and auth header shape internally:
  chat(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent>;
}

const PROVIDERS: Record<string, ProviderAdapter> = { /* one entry per provider */ };

interface Credential {
  getToken(): Promise<string>;
  // kind "api_key" — decrypt stored key
  // kind "oauth"   — refresh-if-expired (single-flight), persist, return access token
}
```

- Internal `ChatRequest`/`ChatEvent` types are ours; adapters map them to each
  provider's wire format. Providers sharing the OpenAI-compatible dialect share one
  base class (~300 lines: fetch POST, SSE parsing, streamed tool-call accumulation)
  and differ only in constants; providers with native protocols implement `chat`
  themselves. Zod-validated tool args. Agent loop (~100 lines): while response has
  tool calls → execute → append results → re-send — with a hard cap on tool
  calls per run (start at 50): when hit, the run stops and still posts the PR
  comment — the tokens are spent, so the evidence ships. The comment states
  the run hit its budget cap, with per-step results up to that point and the
  remaining steps listed as "not reached" (not "failed" — the app didn't fail,
  Croft ran out). The check-run is neutral/failure, never success, and the
  run's DB status is `cap_hit` — distinct from `passed`/`failed`/`error` — so a
  partial run can't masquerade as a green tick anywhere. The cap is the real
  cost bound; `job-timeout` only caps infra, which is pennies next to tokens.
- **API key auth (launch):** pasted in the UI, stored encrypted. Header shape is
  owned by the adapter (it knows the provider's wire format — `x-api-key` vs
  `Authorization: Bearer`); `Credential` only yields the raw secret/token.
- **OAuth auth (launch):** one generic authorization-code + PKCE implementation
  (`node:crypto`) driven by the adapter's `oauth` constants. Two ways the code
  gets back to us, per adapter:
  - **Redirect:** `/oauth/start` → authorize URL; `/oauth/callback` → code→token
    exchange. For providers that let us register our own redirect URI.
  - **Code paste (Anthropic):** reuse the same flow Claude Code uses — its fixed
    public client id and Anthropic's own callback page, which displays the code;
    the UI shows the authorize link and a paste box, then does the same
    code→token exchange. No client registration needed.

  Refresh tokens + transparent refresh make credentials usable indefinitely
  either way.
- Adding a provider = one new adapter class + registry entry + deploy.
- Tokens/keys encrypted at rest: AES-256-GCM (`node:crypto`), key in a secret env var
  on the container. Never logged.
- Active model is `config.activeModel = { providerId, model, credentialId }`,
  read once and snapshotted onto the run row at
  run start — switching models in the UI needs no redeploy.

## UI

- **Runs** — bare status list: PR, mode, status (queued/running/passed/failed),
  timestamps, and a link out to the PR comment on GitHub. Each run also has a
  minimal detail page whose only content is a `<video>` player for the run's
  webm — this is what the PR comment's video link points at (GitHub can't inline
  externally hosted video). No event timeline, no inline screenshots in the list,
  no live updates (so no SSE and no polling).
- **New run** — lists open PRs across the allow-listed repos (fetched on demand via
  `GET /repos/{owner}/{repo}/pulls`, no webhooks involved); pick a PR and mode
  (test/review), optional preview-URL override (else discovered from the PR's
  "preview deployment" comment). Results always go to the PR on GitHub — the
  report is a PR comment, not a UI artifact, and there is no opt-out.
- **Models** — provider + model pickers populated from the code registry; per
  provider, paste an API key or "Connect with OAuth" (PKCE, auto-refresh thereafter).
  Switch the active model any time.
- **Chat** — ask Croft about a PR.
- **Export & clean up** — see below.
- **Settings** — GitHub App install, repo allow-list, the GitHub username
  allow-list (`config.allowedUsers` — add/remove users permitted to trigger
  Croft via comments), triggers, and a master on/off toggle for all
  webhook-driven actions (`webhooksEnabled`).
- Dashboard auth: GitHub OAuth login restricted to my username.

## Export & purge

Two independent features. Export is "give me a zip of old runs"; purge is "delete old
runs". Neither gates the other — the 60-day Object Storage lifecycle rule already
deletes artifacts on its own, so requiring an export first would be a lie (the objects
may already be gone). Export skips S3 objects that no longer exist.

- `GET /api/export?before=<date>` — streams a zip (never buffered; `archiver`,
  compression level 1 since payloads are webm/png):

  ```
  export-<date>/
    runs.jsonl        (runs older than cutoff)
    events.jsonl      (their event rows)
    artifacts/<runId>/<filename>   (S3 objects, streamed one at a time)
  ```

- `POST /api/purge { before }` — `DeleteObjectsCommand` in batches of 1000 +
  `DELETE FROM events/runs`.
- UI: date picker with **Download zip** and, separately, **Delete data older than**
  behind a type-to-confirm.
- If exports ever outgrow the container request timeout: move the same zip code into
  a Serverless Job that writes to `exports/` in the bucket and hand back a presigned
  URL. Start with direct streaming.

## Stack & packages

- **Runtime:** Node + TypeScript with `pnpm` package manager.
- **GitHub:** `@octokit/app` + `@octokit/webhooks`.
- **Browser:** `playwright`, Chromium only.
- **DB:** `drizzle-orm` + `postgres`, `drizzle-kit` migrations.
- **Object storage:** `@aws-sdk/client-s3` (endpoint `s3.fr-par.scw.cloud`).
  Artifact objects are public-read and referenced by their plain URLs — no
  presigning, no proxying. Presigned URLs don't work in PR comments: Camo
  caches the first fetch, then the signature expires and the image rots.
- **Zip export:** `archiver`.
- **Jobs API:** `@scaleway/sdk` or raw fetch with `X-Auth-Token`.
- **Validation:** `zod`.
- **Dashboard auth:** `better-auth` (GitHub provider) or hand-rolled.
- Everything else is `fetch` and `node:crypto`. No `@google-cloud/*`, no AI SDKs.

## Postgres schema (initial)

- `runs` — id (UUID — artifact keys are `<runId>/<filename>` on a public-read
  bucket, so ids must be unguessable, never serial), pr number/repo, mode,
  status (`queued` → `starting` → `running` → `passed` | `failed` | `cap_hit` |
  `error` — the row is created before the Jobs API is called, so a job that
  never launches is a visible `error`, not a run stuck in limbo), preview url,
  providerId + model (snapshotted at run start —
  `config.activeModel` changes over time, and old runs must stay attributable
  to the model that produced them), timestamps.
- `events` — run id, seq, type, payload jsonb, artifact key.
- `webhook_deliveries` — delivery id (PK), received-at; insert-or-ignore for
  idempotency.
- `credentials` — providerId, kind (api_key | oauth), encrypted blob (key, or
  access/refresh tokens), expiry.
- `config` — activeModel `{ providerId, model, credentialId }`, `webhooksEnabled`,
  repo allow-list, allowedUsers (GitHub usernames permitted to trigger Croft via
  comments, in addition to owners/members/collaborators).

Serverless SQL is pooled Postgres: no temporary tables, and `SET` / `search_path` leak
across clients. Keep every statement self-contained; Drizzle migrations are unaffected.

## Scaleway deployment (region: fr-par everywhere)

0. **Account:** Project `croft` in the work Org. IAM application `croft-deploy` with
   Containers/Jobs/Registry/ServerlessSQL/ObjectStorage full access scoped to the
   project; API key. `scw init`.
1. **Registry:** `scw registry namespace create name=croft is-public=false`.
   Two images: `croft/web` (control plane) and `croft/worker`.
   Scaleway wants images under 2 GB, and `mcr.microsoft.com/playwright` ships every
   browser plus their deps, so build the worker from `node:22-bookworm-slim` +
   `npx playwright install --with-deps chromium`, multi-stage, dev deps pruned.
   Build with `--platform linux/amd64` on Apple Silicon.
2. **DB:** `scw sdb-sql database create name=croft cpu-min=0 cpu-max=1`
   (cpu-min=0 → scales to zero; waking an idle database adds a few seconds to the
   first queries, which is fine). Run Drizzle migrations from laptop.
3. **Bucket:** `croft-artifacts`, objects public-read but bucket listing
   disabled (public objects + open listing = anyone can enumerate every
   artifact), lifecycle rule deleting objects > 60 days.
4. **Control plane:** Serverless Container `web` — `min-scale=0 max-scale=1`,
   250 mCPU / 512 MB, port 3000. Env: `DATABASE_URL`, `S3_BUCKET`; secret env:
   `TOKEN_ENC_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY`,
   `SCW_SECRET_KEY` (job-start capable). Public URL = webhook endpoint + dashboard.
5. **Worker:** Jobs definition `croft-worker` — 1 vCPU / 2048 MB (floor for Chromium;
   don't go bigger), `job-timeout=30m` (hard cost bound per run). Definition env:
   `DATABASE_URL` and S3 credentials (the worker writes events and artifacts
   itself). Started via `POST /job-definitions/{id}/start` with per-run env
   (`RUN_ID`, `PR_NUMBER`, `PREVIEW_URL`).
6. **GitHub App:** webhook → `https://<web-url>/api/webhooks/github`; permissions:
   PRs r/w, checks w, contents r; events: `pull_request`, `issue_comment`.
   Private key + secrets into container env.
   Install on work repos.
7. **LLM OAuth:** for redirect-based providers, register
   `https://<web-url>/oauth/callback` as the redirect URI for that provider's
   OAuth client. Anthropic needs no registration: its adapter uses the Claude
   Code public client and code-paste flow. Client ids/URLs live in each
   adapter's constants. For Anthropic, try OAuth using general best practices and
   standards, even if it doesn't actually work (it can be used as sample code,
   worst case, for another provider).
8. **CI:** GitHub Actions on `main`: build/push both images, `scw container deploy`
   for web. Scaleway's docs don't guarantee `:latest` is re-resolved on each job
   run, so CI also updates the job definition's image (unique tag per build) to be
   safe. CI-scoped IAM key in Actions secrets.

### Cost controls

- Idle = €0: container min-scale 0, DB cpu-min 0, jobs exist only while running.
- Per run ≈ 10 min × 1 vCPU/2 GB = 1 200 GB-s + 600 vCPU-s. The Jobs free tier is
  400 000 GB-s and 200 000 vCPU-s per month, so ~300 runs/month cost nothing.
- Guardrails: `job-timeout=30m`, `max-scale=1`, 60-day bucket lifecycle rule,
  billing alert on the project at €5. The dominant cost is LLM tokens, not
  infra — bounded by the per-run tool-call cap and screenshot downscaling
  above; note the €5 billing alert cannot see provider-side LLM spend.
- Everything in fr-par; artifacts served directly from the bucket's public URLs
  (never proxied through the control plane).

## Build order

1. GitHub App + webhook handler + schema (`runs`, `events`, `credentials`, `config`).
2. LLM layer: internal types, provider adapter registry with first adapters, both
   credential kinds (api_key and generic PKCE OAuth).
3. Agent loop + Playwright tools, run locally against one real PR end-to-end
   (screenshot → PR comment). **Prove this before anything else.**
4. Worker image + Serverless Jobs + artifact upload + PR reporting.
5. UI: runs log + model config. Then OAuth credential type.
6. Export & purge.
7. Q&A mode.
8. Review mode (stretch).
