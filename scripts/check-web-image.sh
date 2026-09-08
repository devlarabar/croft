#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

name="croft-next-check-$$"
cleanup() {
  if [ "$?" -ne 0 ]; then docker logs "$name-web" 2>&1 || true; fi
  docker rm -fv "$name-web" "$name-db" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --platform linux/amd64 -f apps/web/Dockerfile -t croft-web-check .
docker build --platform linux/amd64 -f apps/worker/Dockerfile -t croft-worker-check .
docker network create "$name" >/dev/null
docker run -d --name "$name-db" --network "$name" -p 127.0.0.1::5432 \
  -e POSTGRES_USER=croft -e POSTGRES_PASSWORD=croft -e POSTGRES_DB=croft_next_test \
  postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$name-db" pg_isready -U croft -d croft_next_test >/dev/null 2>&1; then break; fi
  sleep 1
done

export DATABASE_URL="postgres://croft:croft@$(docker port "$name-db" 5432/tcp)/croft_next_test"
export TOKEN_ENC_KEY="$(openssl rand -hex 32)"
pnpm --filter @croft/core build
pnpm --filter @croft/core migrate

docker run -d --platform linux/amd64 --name "$name-web" --network "$name" \
  --memory=512m --cpus=0.25 -p 127.0.0.1::3000 \
  -e DATABASE_URL="postgres://croft:croft@$name-db:5432/croft_next_test" \
  -e TOKEN_ENC_KEY="$TOKEN_ENC_KEY" -e CROFT_API_KEY=image-test-key \
  -e GITHUB_OAUTH_CLIENT_ID=image-test-client -e GITHUB_WEBHOOK_SECRET=image-test-secret \
  croft-web-check >/dev/null
export WEB_TEST_URL="http://$(docker port "$name-web" 3000/tcp)"
curl -fsS --retry 30 --retry-all-errors --retry-delay 1 "$WEB_TEST_URL/styles.css" >/dev/null
pnpm --filter @croft/web test:deployment
docker stats --no-stream "$name-web"
