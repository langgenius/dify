
FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/admin/package.json apps/admin/package.json

RUN pnpm install --frozen-lockfile --filter @knowledge/admin...

COPY apps/admin apps/admin

RUN pnpm --filter @knowledge/admin build

FROM node:22-bookworm-slim

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /workspace

COPY --from=builder /workspace/apps/admin/.next/standalone ./
COPY --from=builder /workspace/apps/admin/.next/static ./apps/admin/.next/static

EXPOSE 3000

USER node

CMD ["node", "apps/admin/server.js"]
