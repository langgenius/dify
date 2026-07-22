# Extract API Evidence Bundle Assembler

## Summary

- Extracted EvidenceBundle assembly and rule-based answerability evaluation from the API gateway god file into `packages/api/src/evidence-bundle-assembler.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail so assembler/evaluator logic cannot drift back into the gateway.

## Why

- Continues the R6 code review remediation work by separating answer assembly from HTTP routing and repository orchestration.
- Keeps answerability policy testable without importing the gateway entrypoint.

## TDD

- RED: added the code-health guardrail first, which failed because `evidence-bundle-assembler.ts` did not exist.
- GREEN: extracted the assembler/evaluator contracts and implementation, then reran focused API tests.

## Performance Notes

- Preserved bounded `maxItems` and `maxMissingEvidence` checks before building output payloads.
- Added no database or object-storage calls, so this slice introduces no N+1 query surface.
- Retained schema validation on assembled bundles while keeping retrieval item conversion isolated in the existing helper.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 7 after review checkpoint `0e46d78`; the next mandatory 10-commit review is not due yet.
