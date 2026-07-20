# Source Comparison Service

## Summary

- Added a reusable `createSourceComparisonService()` boundary for Sprint 18 source comparison.
- The service accepts an `EvidenceBundle`, compresses evidence items into bounded source summaries, calls an injected judge/provider, and returns a structured comparison report.
- Exported the source comparison contracts from `@knowledge/api` for later conflict detection and research workflow wiring.

## Performance And Safety Notes

- `maxEvidenceItems` prevents unbounded comparison fan-out.
- `maxItemTextBytes` prevents oversized prompt/source payloads before calling the judge/provider.
- Inputs are parsed through `EvidenceBundleSchema` and cloned before mutation-sensitive use.
- Reports attach source locations by node id without extra database reads.
- This slice intentionally does not add a list/API endpoint, keeping the new capability as a reusable orchestration primitive.

## TDD Notes

- RED first:
  - `pnpm --filter @knowledge/api test -- src/source-comparison.test.ts` failed because `./source-comparison` did not exist.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/source-comparison.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/source-comparison.ts packages/api/src/source-comparison.test.ts packages/api/src/index.ts`

## Full Verification

- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`
