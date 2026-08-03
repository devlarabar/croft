# Build from the repo root: docker build -f apps/web/Dockerfile --platform linux/amd64 .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
# --ignore-scripts: no dep postinstall (esbuild etc.) is needed in the image.
RUN pnpm install --frozen-lockfile --ignore-scripts
# skills/test-plan.md is codegen input for @croft/core's build.
COPY skills skills
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @croft/core build && pnpm --filter @croft/web build

FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY apps/web/public apps/web/public
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "apps/web/dist/index.js"]
