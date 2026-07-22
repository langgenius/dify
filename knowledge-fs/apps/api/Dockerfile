FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/adapters/package.json packages/adapters/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/compute/package.json packages/compute/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/dify-datasource-runtime-client/package.json packages/dify-datasource-runtime-client/package.json
COPY packages/dify-model-runtime-client/package.json packages/dify-model-runtime-client/package.json
COPY packages/embeddings/package.json packages/embeddings/package.json
COPY packages/generation/package.json packages/generation/package.json
COPY packages/parsers/package.json packages/parsers/package.json
COPY packages/plugin-daemon-client/package.json packages/plugin-daemon-client/package.json

RUN pnpm install --frozen-lockfile --filter @knowledge/api-app...

COPY apps/api apps/api
COPY packages/adapters packages/adapters
COPY packages/api packages/api
COPY packages/compute packages/compute
COPY packages/core packages/core
COPY packages/database packages/database
COPY packages/dify-datasource-runtime-client packages/dify-datasource-runtime-client
COPY packages/dify-model-runtime-client packages/dify-model-runtime-client
COPY packages/embeddings packages/embeddings
COPY packages/generation packages/generation
COPY packages/parsers packages/parsers
COPY packages/plugin-daemon-client packages/plugin-daemon-client

RUN pnpm --filter @knowledge/api-app build:prod

FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /workspace

COPY --from=builder /workspace/apps/api/dist/server.mjs ./server.mjs

EXPOSE 8787

USER node

CMD ["node", "server.mjs"]
