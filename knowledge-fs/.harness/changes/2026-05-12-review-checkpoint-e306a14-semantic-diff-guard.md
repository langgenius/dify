# 10-Commit Review Checkpoint: Semantic Views And Structured Retrieval

## Reviewed Range

- Previous reviewed checkpoint: `0ad7592`.
- Reviewed implementation commits:
  - `cb315d4 Add graph expansion retrieval path`
  - `782b643 Add graph incremental maintenance`
  - `c6f5e65 Add KnowledgeFS by-entity view`
  - `e31b8c8 Add KnowledgeFS by-topic view`
  - `8492df2 Add semantic view freshness metadata`
  - `c1e649a Add async semantic view materialization`
  - `0471938 Add query-dependent virtual trees`
  - `681ee50 Add table-specific retrieval`
  - `e9bf0fd Add image OCR-aware retrieval`
  - `e306a14 Add semantic diff flow`
- Remediation checkpoint after review: `7a7672c`.

## Findings

- Technical direction remains aligned with `.harness`: KnowledgeFS, provider orchestration, graph/semantic view reads, and retrieval wrappers remain TypeScript/Hono-owned; Rust changes remain pure WASM compute only.
- Database-facing paths reviewed in this cycle keep tenant scoping, explicit limits, stable cursor ordering, and batched repository calls for graph expansion, semantic path listing, and materialized topic writes.
- Table/OCR retrieval wrappers add at most one extra bounded retrieval leg each and do not introduce per-result database calls.
- Query virtual trees are bounded at the route layer; they currently read persisted trace metadata and retain the already-recorded follow-up risk that very large trace payloads should later move to a dedicated bounded repository.
- High-priority issue found: semantic diff provider output lacked runtime size bounds, creating response and memory amplification risk if a provider returned oversized changes/evidence/metadata.

## Remediation

- Added bounded `SemanticDiffSummarySchema` validation before semantic provider output enters KnowledgeFS responses.
- Bounded semantic output to 100 changes, 20 evidence strings per change, 8,000 characters per summary/evidence field, 200 model characters, and 16 KiB of metadata JSON.
- Oversized or malformed semantic provider output now returns `503 { error: "KnowledgeFS semantic diff provider returned invalid output" }`.
- Added regression coverage that failed before the fix and passes after it.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts --runInBand` failed because oversized semantic provider output returned 200.
- Focused verification passed:
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Follow-Up

- Production semantic diff provider wiring should enforce equivalent output limits before returning provider responses.
- Query virtual trace trees remain acceptable for current bounded MVP behavior; if trace metadata grows materially, promote query evidence/conflicts/missing views to dedicated indexed repositories.
