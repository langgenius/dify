# CJK/English FTS Tuning

## What Changed

- Added `normalizeMixedLanguageFtsText()` to `@knowledge/api`.
- `createFtsProjectionBuilder()` now stores normalized FTS text instead of raw node text.
- FTS projection metadata now records `ftsLanguageStrategy: "mixed-cjk-latin-v1"`.
- PostgreSQL and TiDB FTS retrieval now pass normalized query parameters into database-native FTS SQL.
- Added tests covering:
  - Mixed Chinese/English normalization such as `合同ABC-123续约 terms`.
  - English normalization and punctuation-only empty normalization.
  - FTS projection metadata strategy and normalized text.
  - PostgreSQL and TiDB retrieval query parameter normalization.

## Why

Phase 2 Sprint 5 starts retrieval quality hardening. Mixed CJK/English content is a known risk because PostgreSQL `simple` FTS and TiDB FULLTEXT do not expose identical tokenization behavior. A shared normalization step makes both indexing and query parameters more predictable before live backend-specific pg_jieba/pg_bigm or TiDB parser configuration is wired.

## Performance And Safety

- Normalization runs once per node during FTS projection build and once per FTS query.
- Retrieval still uses one bounded parameterized FTS SQL query with explicit `topK` and `maxRows`.
- No unbounded scans or additional database round trips were introduced.
- Query text is still passed as a parameter, not interpolated into SQL.

## Verification

- RED confirmed with `pnpm --filter @knowledge/api test -- src/gateway.test.ts`; tests failed because the normalizer and normalized FTS behavior did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/api typecheck`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This is a portable fallback strategy, not a substitute for live PostgreSQL pg_jieba/pg_bigm or TiDB parser validation.
- Existing FTS rows created before this change would need projection rebuild to get normalized `ftsText`.
- Future retrieval optimization should compare raw FTS, normalized FTS, and backend-native CJK parser behavior with golden questions.
