# Croft

Self-hosted agent that tests GitHub PRs against their preview deployments.
See `docs/project-setup-planning/PLAN.md` for the full design.

Monorepo: `packages/core` (schema, LLM layer, GitHub/S3 helpers), `apps/web`
(control plane + dashboard, Hono), `apps/worker` (agent runtime, Playwright).

## Environment variables

### Web container (`apps/web`)

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Serverless SQL Postgres connection string |
| `S3_BUCKET` | artifact bucket name (default `croft-artifacts`) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Object Storage credentials |
| `TOKEN_ENC_KEY` | 32 bytes hex — AES-256-GCM key for stored secrets, also signs session cookies |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | GitHub App (PRs r/w, checks w, contents r; events `pull_request`, `issue_comment`) |
| `GITHUB_WEBHOOK_SECRET` | webhook signature secret |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth app for dashboard login |
| `DASHBOARD_USER` | the single GitHub username allowed to log in |
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
builds everything, then serves the dashboard on http://localhost:3000 with
`tsc --watch` + `node --watch` reload. Defaults it exports (override by
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
  node apps/worker/dist/index.js
```
(with the same `DATABASE_URL`/S3/`TOKEN_ENC_KEY` env as dev.sh exports.)

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

## Migrations

CI runs migrations against prod on every deploy (needs the `DATABASE_URL`
Actions secret). To run them manually:

```sh
DATABASE_URL=<prod-connection-string> pnpm --filter @croft/core migrate
```

## Deploy

Provisioning (registry, DB, bucket, container, job definition, GitHub App,
billing alert) is manual — steps in PLAN.md §Scaleway deployment. CI
(`.github/workflows/deploy.yml`) builds both images on push to `main`, pushes
them to `rg.fr-par.scw.cloud/croft`, redeploys the web container and points the
job definition at the new worker tag. Actions secrets: `SCW_SECRET_KEY`,
`SCW_CONTAINER_ID`, `SCW_JOB_DEFINITION_ID`, `DATABASE_URL`.
