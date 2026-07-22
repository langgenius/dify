# Standalone Docker API Image

## What Changed

- Added `apps/api/Dockerfile` for a standalone Node 22 API image.
- Added `.dockerignore` to keep caches, build output, local env files, and repository metadata out of Docker build context.
- Added `apps/api/src/server.ts` with `@hono/node-server` so the Hono gateway can run as a standalone HTTP process.
- Added tested API port parsing in `apps/api/src/server-options.ts`.
- Added API app `start` script and changed `dev` to watch the real server entrypoint.
- Added root `pnpm docker:api:build`.
- Updated Compose so the `api` service builds and runs `knowledge-fs-api:local` with production `NODE_ENV`, while the Admin service remains a dev container.
- Updated `infra/local/README.md` with standalone image behavior and build command.

## Why

Sprint 4 requires one-command local deployment for the standalone target. The API service now has a real server entrypoint and a Docker image boundary instead of depending on a bind-mounted repository and development watcher.

## Performance And Safety

- The Docker image uses `pnpm install --frozen-lockfile --prod --filter @knowledge/api-app...` to avoid installing unrelated workspace dev dependencies in the runtime image.
- `.dockerignore` excludes local caches and `.env` files from the build context.
- The server entrypoint only binds the existing Hono app and keeps runtime behavior inside the gateway/adapters.
- Port parsing rejects invalid values before starting the server.

## Verification

- RED confirmed:
  - `test -f apps/api/Dockerfile` failed before the Dockerfile existed.
  - `pnpm --filter @knowledge/api-app start` failed before the start script existed.
  - `pnpm --filter @knowledge/api-app test -- src/server-options.test.ts` failed before `server-options.ts` existed.
- Focused verification passed:
  - `test -f apps/api/Dockerfile`
  - `pnpm --filter @knowledge/api-app test -- src/server-options.test.ts`
  - `pnpm --filter @knowledge/api-app typecheck`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
- Full verification passed:
  - `pnpm install`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
- `pnpm docker:api:build` is wired, but could not run in this environment because the local Docker daemon is unavailable at `unix:///Users/jyong/.docker/run/docker.sock`.

## Known Risks And Follow-Up

- Live image build and container startup still need to be run in an environment with Docker daemon access.
- The image runs TypeScript through `tsx` for this early standalone milestone; a later production packaging pass should introduce emitted/bundled artifacts and a slimmer runtime image.
- This commit reaches the 10-implementation-commit cadence after checkpoint `292d012`; a health review must run before more feature iteration.
