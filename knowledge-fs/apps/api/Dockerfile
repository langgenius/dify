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

RUN pnpm --filter @knowledge/api-app build:prod

# sharp loads a platform-specific native module at runtime. The API bundle keeps
# sharp external, so copy its resolved production dependency closure instead of
# assuming esbuild can embed the native .node and libvips artifacts.
RUN sharp_runtime_source="$(dirname "$(realpath apps/api/node_modules/sharp)")" \
    && mkdir -p /runtime/node_modules \
    && cp -LR "${sharp_runtime_source}/." /runtime/node_modules/

FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /workspace

COPY --from=builder /workspace/apps/api/dist/server.mjs ./server.mjs
COPY --from=builder /workspace/apps/api/dist/migrate.mjs ./migrate.mjs
COPY --from=builder /runtime/node_modules ./node_modules

# Fail the image build if the target platform's sharp binary or libvips payload
# is absent. Importing the JavaScript wrapper alone is not sufficient.
RUN node --input-type=module --eval "const sharp = (await import('sharp')).default; const { data, info } = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer({ resolveWithObject: true }); if (data.byteLength < 1 || info.format !== 'png' || info.width !== 1 || info.height !== 1) throw new Error('sharp native runtime smoke failed')"

EXPOSE 8787

USER node

CMD ["node", "server.mjs"]
