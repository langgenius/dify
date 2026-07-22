# Citation Normalization

## What Changed

- Added `createCitationNormalizer()` to `@knowledge/generation`.
- Normalizes generated answer citation markers against packed evidence items.
- Removes orphan markers from answer text while reporting them for traceability.
- Maps valid markers to bounded citation metadata: marker, node id, score, and cloned source citations.
- Added safety guards for maximum answer bytes, maximum citation count, and duplicate evidence markers.
- Added focused generation tests for valid marker mapping, orphan cleanup, byte bounds, citation-count bounds, and duplicate marker rejection.

## Why

Generation output needs a deterministic, bounded post-processing step before API responses or future cache entries rely on citations. This keeps answer text from exposing unsupported citation markers and gives downstream trace/UI layers a structured citation list tied to the EvidenceBundle packing result.

## Performance Notes

- The normalizer is pure in-memory compute over already-packed evidence and the generated answer text.
- It performs no provider, database, cache, object-storage, or trace round-trips.
- Answer text and citation count are explicitly bounded to prevent unbounded regex scans or retained citation arrays.
- Returned citation metadata is cloned so callers cannot mutate retained evidence citation state.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`: passed.
- `pnpm --filter @knowledge/generation typecheck`: passed.
- `pnpm --filter @knowledge/generation test:coverage`: passed.
- `pnpm lint`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- Citation normalization is currently exposed as a reusable generation utility and is not yet wired into the SSE query route. The next generation/cache slices should decide the final response-envelope shape for normalized citations.
- Marker syntax is intentionally narrow (`[E<number>]`) to match the evidence packer output; future prompt templates that introduce new citation formats must version the normalizer or add explicit tests.
