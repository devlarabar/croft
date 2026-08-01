#!/usr/bin/env bash
# One-command local dev stack: docker services, migrations, build watch, web app.
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env if present; values there win over the defaults below.
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

docker compose up -d

export DATABASE_URL=${DATABASE_URL:-postgres://croft:croft@localhost:5432/croft}
export S3_ENDPOINT=${S3_ENDPOINT:-http://localhost:9000}
export S3_BUCKET=${S3_BUCKET:-croft-artifacts}
export S3_ACCESS_KEY=${S3_ACCESS_KEY:-croft}
export S3_SECRET_KEY=${S3_SECRET_KEY:-croftcroft}
# Well-known local-only key (hex of "croft-dev-only!!" twice). Export your own
# TOKEN_ENC_KEY before pasting real API keys you care about.
export TOKEN_ENC_KEY=${TOKEN_ENC_KEY:-63726f66742d6465762d6f6e6c79212163726f66742d6465762d6f6e6c792121}
export DEV_NO_AUTH=${DEV_NO_AUTH:-1}
export WEB_URL=${WEB_URL:-http://localhost:3000}

echo "waiting for postgres..."
until docker compose exec -T postgres pg_isready -U croft >/dev/null 2>&1; do sleep 0.5; done

pnpm build
pnpm --filter @croft/core migrate

trap 'kill 0' EXIT
pnpm -r --parallel exec tsc --watch --preserveWatchOutput &
echo "dashboard: http://localhost:3000 (auth disabled)"
node --watch apps/web/dist/index.js
