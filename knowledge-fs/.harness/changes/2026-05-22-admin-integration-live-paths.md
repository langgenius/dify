# Admin Integration Live Paths

## What Changed

- Fixed the Admin upload form so it no longer submits the invalid default `sourceId=manual-upload`; `sourceId` remains optional and is only forwarded when the user provides a value.
- Changed the Admin `Check parser` control from a no-op button to a real BFF health link.
- Changed query citation links from the nonexistent `/api/bff/queries/{traceId}` path to the existing `/api/bff/traces/{traceId}` path.
- Aligned Admin BFF graph and KnowledgeFS allowlist methods with the Hono API/client contract by forwarding GET requests instead of POST bodies for those live read routes.
- Replaced the bare upload `status 404` message with a configuration-oriented error that points at `NEXT_PUBLIC_API_BASE_URL` and API startup.
- Added a focused Admin-to-API integration test covering upload through the Admin redirect handler, BFF default workspace bootstrap, Hono document upload, and parse artifact read.
- Documented how to diagnose a local port conflict where Admin points at `localhost:8787` but another service, not the KnowledgeFS API, is answering.

## Why

- The Admin page exposed controls that looked live but could fail because the frontend defaults or BFF methods did not match backend contracts.
- The user-reported upload failure needed a regression test that exercises the real Admin/BFF/API path, not only isolated mocks.
- Keeping read-style BFF routes GET-only reduces accidental body forwarding and keeps the BFF allowlist tighter.

## Verification

- `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/bff.test.ts`
- `pnpm --filter @knowledge/admin test -- lib/upload-action.test.ts app/page.test.tsx lib/bff.test.ts`
- `pnpm --filter @knowledge/api test -- src/admin-bff-integration.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/admin typecheck`
- `pnpm --filter @knowledge/admin test`
- `pnpm --filter @knowledge/admin test:coverage`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`
- Browser-adjacent source-render check with `curl --max-time 5 http://localhost:3100` confirmed the Admin HTML no longer contains `manual-upload` and exposes `/api/bff/health`; the in-app browser automation timed out while loading the local dev tab, so the DOM was verified through the rendered HTML response instead.

## Known Risks / Follow-Up

- Several Admin panels are still intentionally preview data. AIR.2 will either route remaining visible controls through dedicated JSON-transforming handlers or make preview-only controls non-submitting so they cannot imply completed product behavior.
