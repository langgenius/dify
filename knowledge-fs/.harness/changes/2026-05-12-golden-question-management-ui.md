# Golden Question Management UI

## Summary

- Added the Phase 6 golden question management surface to the Admin Console.
- Extended the shared Admin API client with bounded golden question CRUD methods.
- Opened only the required golden question routes through the Admin BFF proxy.

## Key Changes

- Added Admin API client models and methods for:
  - `listGoldenQuestions`
  - `createGoldenQuestion`
  - `getGoldenQuestion`
  - `updateGoldenQuestion`
  - `deleteGoldenQuestion`
- Added bounded client validation for list limits, required ids, and non-empty question text.
- Added response validation and clone-style mapping for golden question arrays, tags, expected evidence ids, and metadata.
- Added BFF allowlist coverage for:
  - `GET/POST /knowledge-spaces/{id}/golden-questions`
  - `GET/PATCH/DELETE /knowledge-spaces/{id}/golden-questions/{questionId}`
- Added an Admin Console panel for golden question creation, expected evidence entry, tags, selected-row update/delete actions, and current page cursor visibility.

## Performance Notes

- Client list calls require an explicit limit and enforce the configured `maxListLimit`.
- The UI shows cursor-based pagination state instead of implying unbounded list loading.
- BFF routing remains path allowlisted and still rejects arbitrary nested golden question paths.
- No new server-side database access paths were introduced; the UI and BFF reuse existing tenant-scoped Hono golden question APIs.

## TDD

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts lib/bff.test.ts app/page.test.tsx` failed because the client methods, BFF routes, and UI panel were missing.
- GREEN:
  - Implemented the minimal client, BFF, and page changes.
  - Focused Admin tests and typecheck passed.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts lib/bff.test.ts app/page.test.tsx`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This will be implementation commit 7 after reviewed checkpoint `55f83ef`.
