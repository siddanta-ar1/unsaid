# Multi-stage so the runtime image carries no build toolchain and no sources.
FROM node:20-alpine AS build
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Copy manifests first so a dependency install is cached across code changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/crypto/package.json packages/crypto/
COPY packages/solana/package.json packages/solana/
COPY backend/api/package.json backend/api/
RUN pnpm install --frozen-lockfile --filter @unsaid/api...

COPY packages packages
COPY backend/api backend/api
# --legacy: pnpm 10 otherwise requires inject-workspace-packages, which would
# change how the workspace resolves locally for the sake of one build step.
RUN pnpm --filter @unsaid/api... build \
 && pnpm deploy --legacy --filter @unsaid/api --prod /out

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Never run as root; the process needs no write access to its own image.
RUN addgroup -S unsaid && adduser -S unsaid -G unsaid
COPY --from=build --chown=unsaid:unsaid /out ./
USER unsaid

EXPOSE 3011
# The platform health check hits /ready, which reaches Postgres and storage —
# so a container with a broken dependency is replaced rather than left serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3011)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
