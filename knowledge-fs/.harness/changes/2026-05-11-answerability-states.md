# Answerability States

## Summary

- Added a rule-based answerability evaluator for Sprint 6 EvidenceBundle flow.
- EvidenceBundle assembly now uses the shared evaluator by default.

## Changes

- Added `createAnswerabilityEvaluator()` in `@knowledge/api`.
- Added configurable rules:
  - `minFinalScore`
  - `minItems`
- Added answerability outcomes:
  - `answerable`
  - `partial`
  - `not-enough-evidence`
  - `conflict`
  - `permission-limited`
- Integrated the evaluator with `createEvidenceBundleAssembler()`.

## Performance Notes

- The evaluator is pure in-memory logic over already bounded EvidenceBundle items.
- No database, object storage, cache, network, or provider calls were introduced.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This slice will be implementation commit 1 after review checkpoint `f950b59`.
- The next 10-commit review is not due yet.
