# Croft

Self-hosted agent that tests GitHub PRs against their preview deployments.
See `docs/project-setup-planning/PLAN.md` for the full design.

Monorepo: `packages/core` (schema, LLM layer, GitHub/S3 helpers), `apps/web`
(control plane + dashboard, Next.js), `apps/worker` (agent runtime, Playwright).

## Environment variables

### Web container (`apps/web`)

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Serverless SQL Postgres connection string |
| `CROFT_API_KEY` | API key accepted by `GET /api/v1/activity` via the `X-API-Key` header |
| `S3_BUCKET` | artifact bucket name (default `croft-artifacts`) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Object Storage credentials |
| `TOKEN_ENC_KEY` | 32 bytes hex — AES-256-GCM key for stored secrets, also signs session cookies |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | GitHub App (PRs r/w, checks w, contents r; events `pull_request`, `issue_comment`, `pull_request_review_comment`) |
| `GITHUB_WEBHOOK_SECRET` | webhook signature secret |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app for dashboard login |
| `SCW_SECRET_KEY` | Scaleway API key (job-start capable) |
| `SCW_JOB_DEFINITION_ID` | worker job definition to start per run |

### Worker job definition (`apps/worker`)

`DATABASE_URL`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `TOKEN_ENC_KEY`
(decrypts the model credential and preview login), `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `WEB_URL` (public URL of the web container, for the
run-page link in PR comments). Per-run env is injected by the control plane:
`RUN_ID`, `PR_NUMBER`, `PREVIEW_URL`.

## Local development

```sh
pnpm install
pnpm dev
```

`pnpm dev` (scripts/dev.sh) sources `.env` from the repo root if present
(values there override the built-in defaults; keep multi-line secrets like the
GitHub App PEM out of it — export those from a file instead, e.g.
`export GITHUB_APP_PRIVATE_KEY="$(cat croft-pkcs8.pem)"`), starts Postgres and
MinIO via docker compose
(bucket created public-read automatically), waits for the DB, runs migrations,
builds core and worker, then serves the dashboard on http://localhost:3000 with
Next.js hot reload and `tsc --watch` for core and worker. Defaults it exports (override by
exporting your own before running): `DATABASE_URL`,
`S3_ENDPOINT=http://localhost:9000` (switches the S3 client to path-style
MinIO URLs), `S3_BUCKET`, `S3_ACCESS_KEY`/`S3_SECRET_KEY`, `DEV_NO_AUTH=1`,
and a well-known dev `TOKEN_ENC_KEY` — export a real one before pasting API
keys you care about.

`DEV_NO_AUTH=1` bypasses GitHub login so no OAuth app is needed locally.
GitHub-backed features (new-run PR listing, webhooks, Q&A, comment posting)
still need real `GITHUB_APP_*` credentials; the rest of the UI works without
them (export `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` before `pnpm dev`). For
webhooks, point the GitHub App at a tunnel (e.g. `ngrok http 3000`).

Run the worker directly against a run row created via the UI (no Scaleway
involved — leave `SCW_JOB_DEFINITION_ID` unset and the job start will fail
visibly, or just create the row and launch by hand):

```sh
RUN_ID=<uuid> PR_NUMBER=<n> PREVIEW_URL=<url> \
  ARTIFACTS_DIR=/tmp/croft-artifacts WEB_URL=http://localhost:3000 \
  DEV_NO_AUTH=1 node apps/worker/dist/index.js
```
(with the same `DATABASE_URL`/S3/`TOKEN_ENC_KEY` env as dev.sh exports;
`DEV_NO_AUTH=1` is also what lets the well-known dev `TOKEN_ENC_KEY` decrypt —
outside dev, that key is refused at startup.)

## Local ad-hoc mode

With the dev stack running (`pnpm dev`), one request tests any URL against a
supplied plan — the route only exists when `DEV_NO_AUTH=1`:

```sh
curl -N localhost:3000/api/local-runs -d '{
  "url": "http://localhost:8081",
  "plan": "1. Open the front page\n2. ...",
  "context": "optional repo context / test-setup endpoints",
  "login": { "username": "u", "password": "p", "loginUrl": "optional" }
}'
```

The response streams the run's events as NDJSON (`assistant_text`,
`tool_call`, `tool_result`, `video`, then a final `result` line with the
report and the tmp dir holding screenshots + video). The model and tool-call
cap are croft's configured defaults; no run row is written, and the login
credentials only exist in the spawned worker's env. Note the `http_request`
tool is scoped to the target's host — for `localhost` URLs that means
same-host only.

## Activity API

`GET /api/v1/activity` returns Croft's entire latest run row, including his first-person activity in `flavourText`. Send the key configured in `CROFT_API_KEY` as the `X-API-Key` header. Interactive docs are available at `/api/docs`, with the OpenAPI spec at `/api/openapi.json`.

## Dashboard access

Anyone can sign in with GitHub. New accounts get `user` (only a content-unavailable
page); `member` can view runs and videos; `admin` has full dashboard access.
`devlarabar` is seeded as the initial admin, tied to GitHub account ID `122644200`,
and cannot be demoted. Admins manage roles at **Users**, including granting access
by GitHub username before first sign-in and promoting other admins. Roles are
checked on every request, so changes apply to existing sessions immediately.
The Settings comment-trigger allow-list is separate from dashboard access.
Existing sessions must sign in again after this update. `DEV_NO_AUTH=1` retains
full admin access for local development only.

### Run logs and event encryption

Admins can open **View logs** from a run row or its video page. The viewer
shows stored agent events, newest first, with expandable payloads and 50 events
per page; container stdout/stderr still lives in Scaleway. **Copy JSON** and
**Download JSON** export all events for that run in chronological order,
including decrypted payloads, regardless of the page currently displayed.
Members cannot access the viewer or its `/runs/{id}/logs.json` export. Payloads can contain browser inputs and application data;
do not share raw logs or exported archives publicly.

New event payloads use AES-256-GCM with `TOKEN_ENC_KEY`. The existing JSONB
column stores ciphertext as a JSON string. Deploy the web reader first, then
the worker writer, and let workers on the old version finish. With production
`DATABASE_URL` and `TOKEN_ENC_KEY` already exported, backfill historical rows:

```sh
pnpm --filter @croft/core build
pnpm --filter @croft/core encrypt-events
```

The backfill is resumable and processes 100 rows at a time. Existing plaintext
rows remain readable until backfilled; deploy alone does not encrypt them.
Old backups and previously downloaded exports still contain their original
payloads. Admin exports and Q&A decrypt events on the server. This protects
`events.payload`, not run reports, screenshots, videos, or container logs.
Rolling back to a reader predating encryption will break event consumers.

### Video access rollout

Run the database migration and deploy both web and worker. New video uploads
are private and stream through the authenticated dashboard; screenshots remain
public for GitHub PR comments. With the existing S3 credentials exported, run:

```sh
pnpm --filter @croft/core private-videos
```

This removes public object ACLs from existing videos (safe to rerun). Also remove
any bucket policy granting anonymous reads to `.webm` objects, including the
local MinIO public-read policy, or it overrides private object ACLs. Verify an
old video's direct storage URL returns 403 anonymously before considering the
rollout complete. Dashboard playback should still work for members and admins.
The API-key-protected activity endpoint and signed GitHub webhooks are unchanged.

## Migrations

CI runs migrations against prod on every deploy (needs the `DATABASE_URL`
Actions secret). To run them manually:

```sh
DATABASE_URL=<prod-connection-string> pnpm --filter @croft/core migrate
```

## Migration verification

```sh
pnpm --filter @croft/web test
pnpm --filter @croft/web build
bash scripts/check-web-image.sh
```

The image check builds both images for `linux/amd64` and tests the standalone server against
a disposable Postgres database, limited to Scaleway's 512 MB / 250 mCPU budget.
It checks dashboard access, forms, assets, exports and signed webhooks without
calling GitHub, model providers or Scaleway. Its containers and database are
removed on exit; it does not use the development or production database.

## Key rotation

Stop new runs and wait for active workers to finish before rotating keys.
Re-encrypt credentials, preview-login passwords, and encrypted event payloads
under a new `TOKEN_ENC_KEY`:

```sh
DATABASE_URL=<prod> TOKEN_ENC_KEY=<old> NEW_TOKEN_ENC_KEY=<new> \
  pnpm --filter @croft/core rotate-key
```

The script is resumable (rows already on the new key are skipped). Afterwards
set `TOKEN_ENC_KEY` to the new value on the web container and the worker job
definition — remember `scw` env updates replace the whole map.

## Deploy

Provisioning (registry, DB, bucket, container, job definition, GitHub App,
billing alert) is manual — steps in PLAN.md §Scaleway deployment. CI
(`.github/workflows/deploy.yml`) builds both images on push to `main`, pushes
them to `rg.fr-par.scw.cloud/croft`, redeploys the web container and points the
job definition at the new worker tag. The web image runs Next.js standalone on
`0.0.0.0:3000`, with runtime secrets supplied by Scaleway; the image build needs
no database or credentials. Actions secrets: `SCW_SECRET_KEY`,
`SCW_CONTAINER_ID`, `SCW_JOB_DEFINITION_ID`, `DATABASE_URL`.
