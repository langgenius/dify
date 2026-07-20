# Production Bad-Case Capture

## Summary

- Added Phase 6 Sprint 19 production bad-case capture.
- A failed production query can now be captured from an authenticated AnswerTrace and queued into the golden-question evaluation review flow.
- Added Admin Console affordances and BFF/client wiring for the capture route.

## What Changed

- Added `POST /knowledge-spaces/{id}/production-bad-cases`.
  - Requires `knowledge-spaces:write` through the existing protected route middleware.
  - Reads tenant identity from the authenticated subject.
  - Loads the AnswerTrace tenant-safely and rejects cross-tenant or missing traces with `404`.
  - Creates a `GoldenQuestion` tagged `production-bad-case` and `needs-review`.
- Added bounded evidence context metadata:
  - Stores trace id, optional reason, state, item counts, missing-evidence counts, and bounded item summaries.
  - Captures node ids, scores, citation counts, conflict counts, and freshness status.
  - Avoids storing raw JWTs, object bodies, and unbounded evidence payloads.
- Extended Admin:
  - Added `captureProductionBadCase()` to the thin Admin API client.
  - Allowlisted the route in the Admin BFF proxy.
  - Added an Evaluation Dashboard form for trace id, reason, tags, and “Add to eval queue”.

## Performance Notes

- The API performs one tenant-scoped trace lookup and one golden-question create; it does not introduce list queries or query waterfalls.
- Evidence context stored in metadata is bounded to 20 evidence items and 20 missing-evidence entries.
- The resulting evaluation queue continues to use the existing bounded and paginated `GoldenQuestionRepository`.

## TDD / RED

- Added failing API tests for OpenAPI route presence, unauthenticated/forbidden access, tenant-scoped trace capture, cross-tenant hiding, and missing traces.
- Added failing Admin tests for client method, BFF allowlist, and rendered UI.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts lib/bff.test.ts app/page.test.tsx`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/admin test:coverage`
- Full verification before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- Bad-case capture currently queues a reviewable golden question; richer annotation workflows belong to Sprint 20.
- Database-specific persisted bad-case tables are intentionally deferred because the current evaluation queue source of truth is `golden_questions`.

## Cadence

- This will be implementation commit 1 after reviewed checkpoint `7733961`.
- The next 10-commit review is not yet due.
