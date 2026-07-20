# Hallucination And Freshness Flags

## What Changed

- Added generation quality flag metadata to `GenerateTextResult`.
- Added `createGenerationQualityFlagger()` in `@knowledge/generation`.
- Quality metadata now includes:
  - Alignment checker metadata.
  - Ungrounded claim count and ungrounded claim details.
  - Stale cited evidence count and stale marker/node metadata.
  - Stable flags: `ungrounded-claims` and `stale-evidence`.
- Extended result validation so generated responses preserve `metadata.quality`.

## Why

- Sprint 16 requires generation post-processing to surface hallucination and freshness signals.
- The previous slice produced claim-evidence alignment reports; this slice turns those reports plus evidence freshness into response metadata.

## Performance Notes

- The flagger is linear over already-normalized citations and already-assembled evidence bundle items.
- No additional database queries, cache reads, object storage reads, or filesystem operations are introduced.
- If callers inject an LLM alignment judge, that checker remains the only optional network call and is already bounded by the alignment slice.
- Stale evidence detection uses a single in-memory node-id map and dedupes marker/node pairs.

## Verification

- RED first:
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts --runInBand` failed because `createGenerationQualityFlagger` did not exist.
- Focused verification passed:
  - `pnpm exec biome check --write packages/generation/src/index.ts packages/generation/src/generation.test.ts`
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
  - `pnpm --filter @knowledge/generation typecheck`
  - `pnpm --filter @knowledge/generation test:coverage`
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

- This slice adds reusable generation metadata support; API streaming integration can choose whether to emit this metadata in done events once the query generator owns the full generation pipeline.
- Freshness flags currently cover cited stale evidence, not uncited stale candidates.
