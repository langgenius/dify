# Code Review Remediation

## Summary

- Addressed the actionable high/medium-risk findings from `docs/code-review-issues.md` with red-first regression coverage.
- Added lasting guardrails to `.harness/agents/development-requirements.md` so future work does not reintroduce the same classes of issues.
- Left only large architectural items for separate planned refactors where a one-shot patch would be riskier than the underlying issue.

## Fixed Findings

- H2: Added generated foreign key constraints for core document, node, projection, trace, golden-question, and graph relationships.
- H3: `collectPlatformHealth` now treats throwing component checks as unhealthy instead of failing the whole health report.
- H4: Admin forms now submit through `/api/bff/...` instead of directly to the API origin.
- H5: BFF allowlist now includes graph traversal and KnowledgeFS routes used by the shared Admin client.
- H6: Gateway now has structured `notFound` and `onError` handling, while preserving Hono `HTTPException` status responses.
- M1: SQL identifier quoting now escapes embedded dialect quote characters.
- M2/L21: Admin BFF request bodies and Admin JSON responses are chunk-read with explicit byte limits.
- M4/L18: Memory cache now supports `maxTotalBytes` and LRU eviction.
- M7: Inline, Cloudflare, and pg-boss job queues clear idempotency keys on terminal lifecycle transitions.
- M9/M12: TiDB FTS syntax is idempotent, TiDB FTS column type is compatible, PostgreSQL vector storage uses `vector(1536)`, and a generated HNSW index is declared.
- M11/M13: Runtime fallbacks now report honest in-memory kinds instead of pretending to be S3/R2/KV.
- L1/L2: Adapter contracts now expose optional `close()` hooks, and KnowledgeFS virtual path validation is generated from namespace options.
- L6/L10/L11/L12/L14/L15/L17/L23/L25: Fixed WASM `--locked` release builds/profile tuning, accented Latin token runs, percent rounding bias, singular trace labels, Voyage `input_type`, citation off-by-one, rate-limit identity leakage, skipped-heading section paths, and serial research checks.

## Deferred Structural Items

- H1/M5: Full decomposition of `packages/api/src/index.ts` and removal of Hono context `any` workarounds should be its own large refactor with route-by-route module ownership.
- M6: SSE multi-line data semantics are fixed, but true incremental provider event yielding still needs a dedicated streaming parser refactor.
- M8: Incremental migration runner/version tracking is still a larger database lifecycle feature; this slice strengthened checked-in generated artifacts and constraints.
- L5/L7/L9/L13/L20/L22/L24: Docker JS runtime build, WASM wrapper fast paths, shared utility extraction, provider retry/abort semantics, embedding clone reduction, structured provider errors, and streaming object reads remain separate hardening tracks.

## TDD / Verification

- RED coverage was added first for the fixed behaviors in core health aggregation, adapter cache/queue/runtime factories, database schema rendering, Admin BFF/client/UI, generation SSE parsing, parser section paths, embeddings provider request mapping, API gateway errors/rate limits, and research workflow behavior.
- Focused verification passed:
  - `pnpm --filter @knowledge/core test -- src/platform-adapter.test.ts`
  - `pnpm --filter @knowledge/adapters test -- src/cache.test.ts src/adapters.test.ts src/database.test.ts src/job-queue.test.ts`
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts src/migration-file.test.ts`
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/bff.test.ts lib/api-client.test.ts lib/retrieval-studio.test.ts lib/failed-query-diagnostics.test.ts lib/trace-comparison.test.ts`
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
  - `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`
  - `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
  - `pnpm --filter @knowledge/api test -- src/research-workflow.test.ts src/gateway.test.ts`
  - `cargo test --workspace`
  - `pnpm db:migrations:check`
- Full verification passed after fixes:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risk Notes

- Foreign keys are now emitted in initial migration artifacts. Existing live databases would need a reviewed migration plan before applying these constraints to non-empty data.
- The API god file remains the highest maintainability debt; future feature work must avoid adding to it and should extract touched areas opportunistically.
