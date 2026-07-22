# Semantic Diff Flow

## What Changed

- Added an optional semantic diff path to KnowledgeFS `diff` through `semantic=true`.
- Added `SemanticDiffProvider`, `SemanticDiffInput`, and `SemanticDiffSummary` contracts so provider-backed summaries can be injected without coupling KnowledgeFS to a concrete LLM client.
- Extended the diff response schema to include a semantic summary with model, metadata, categorized changes, and evidence strings.
- Kept the existing WASM text diff as the required deterministic base; semantic summaries receive cloned text, operations, stats, and paths.
- Added API coverage for successful semantic summaries, missing semantic provider failures, and compute-unavailable failures.

## Why

- Sprint 15 requires a semantic diff flow on top of the existing deterministic KnowledgeFS diff.
- The provider boundary keeps high-level summarization replaceable while preserving the low-cost WASM diff as the authoritative structural input.
- Fail-closed behavior avoids silently returning incomplete semantic output when compute or provider wiring is absent.

## Performance Notes

- The semantic provider is only called when callers explicitly pass `semantic=true`.
- The route still resolves both files once through the existing bounded `cat` path and reuses those contents for the deterministic and semantic phases.
- Provider input is cloned before crossing the boundary, preventing long-lived provider implementations from mutating route-owned state.
- No database N+1 path was introduced; this change does not add per-operation or per-diff-row database access.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api typecheck` failed because `semanticDiffProvider` did not exist on `KnowledgeGatewayOptions`.
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

## Risks And Follow-Up

- This slice defines the semantic diff provider boundary but does not wire a production LLM provider or prompt template.
- Large semantic summaries should receive explicit provider-side output limits when the production implementation is added.
