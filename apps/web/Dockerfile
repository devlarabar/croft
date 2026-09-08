# Build from the repo root: docker build -f apps/web/Dockerfile --platform linux/amd64 .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
# Next's platform binaries are supplied by optional packages.
RUN pnpm install --frozen-lockfile --ignore-scripts
# skills/*.md and docs/code-standards.md are codegen input for @croft/core's build.
COPY skills skills
COPY docs/code-standards.md docs/
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @croft/core build && pnpm --filter @croft/web build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY apps/web/public apps/web/public
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
