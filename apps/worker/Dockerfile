# Build from the repo root: docker build -f apps/worker/Dockerfile --platform linux/amd64 .
# node-slim + chromium only: mcr.microsoft.com/playwright ships every browser
# and blows Scaleway's 2 GB image limit.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
# --ignore-scripts: dep postinstalls (esbuild binary, playwright browser
# download) aren't needed — Chromium is installed explicitly below.
RUN pnpm install --frozen-lockfile --ignore-scripts
# skills/test-plan.md is codegen input for @croft/core's build.
COPY skills skills
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @croft/core build && pnpm --filter @croft/worker build

FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
# gVisor makes /tmp memory-backed; artifacts (video) go here instead.
RUN mkdir /artifacts
ENV NODE_ENV=production ARTIFACTS_DIR=/artifacts
CMD ["node", "apps/worker/dist/index.js"]
