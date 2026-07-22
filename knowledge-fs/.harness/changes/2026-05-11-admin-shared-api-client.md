# Admin Shared Hono API Client

## What Changed

- Added `apps/admin/lib/api-client.ts`.
- Added a shared fetch client for:
  - `GET /health`
  - `GET /knowledge-spaces`
  - `POST /queries` SSE
- Added typed response parsing for health and KnowledgeSpace list responses.
- Added compact SSE parsing for Admin query streaming.
- Wired the Admin page API base display through the shared client helper.
- Added tests with fake fetch for request URLs, auth headers, response parsing, SSE parsing, and bounded input rejection.

## Why

- Phase 2 Sprint 9 requires the Admin Console to consume Hono APIs through shared/generated client boundaries before live UI workflows are built.

## Performance And Safety Notes

- Client methods enforce bounded list limits and query byte size before network calls.
- Auth tokens are only placed in request headers and are not included in errors, logs, or cache keys.
- The SSE parser only returns structured event/data pairs and rejects malformed JSON.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test` failed because `apps/admin/lib/api-client.ts` was missing.
- Focused verification:
  - `pnpm --filter @knowledge/admin test`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm --filter @knowledge/admin build`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This is a hand-written shared client slice. OpenAPI code generation can replace or generate this boundary in a later pass if desired.
- Upload UI, trace viewer, and live retrieval UI will consume this client in the next Sprint 9 slices.
