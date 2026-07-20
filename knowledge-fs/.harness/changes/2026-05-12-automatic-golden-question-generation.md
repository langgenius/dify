# Automatic Golden Question Generation

## Summary

- Added an LLM-backed automatic golden question generator in `@knowledge/generation`.
- Generated questions are proposals with `pending_review` status and are not inserted into the golden set automatically.
- Added a review workflow that converts approved proposals into golden question repository input and supports explicit rejection.

## Key Changes

- Added `createAutomaticGoldenQuestionGenerator()`.
- Added generated proposal contracts with source node ids, expected evidence ids, tags, metadata, provider/model provenance, and review status.
- Added bounded source-node input validation:
  - `maxSourceNodes`
  - `maxSourceTextBytes`
  - `maxQuestionsPerRun`
- Added strict JSON response validation for LLM output.
- Ensured every generated `expectedEvidenceId` must reference one of the provided source node ids.
- Added `createGoldenQuestionReviewWorkflow()` for approve/reject decisions.
- Approval returns a golden question input with review metadata; rejection records reviewer and reason.

## Performance Notes

- Source context is rejected before provider calls if node count or byte budget is exceeded.
- Generated output is bounded by requested `maxQuestions` and implementation `maxQuestionsPerRun`.
- The generator performs one LLM call per bounded batch and does not write to storage itself.
- Evidence ids are validated against the batch source id set in memory, avoiding follow-up lookups or N+1 checks.

## TDD

- RED first:
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts` failed because the generator and review workflow factories did not exist.
- GREEN coverage includes pending proposals, provider prompt shape, approval gating, rejection, invalid config, oversized input, invalid JSON, over-limit output, and invalid evidence references.

## Verification

- Passed:
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
  - `pnpm --filter @knowledge/generation typecheck`
  - `pnpm --filter @knowledge/generation test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Follow-Up

- A later API slice can persist generated proposals and expose review endpoints in the Admin Console.

## Review Cadence

- This will be implementation commit 8 after reviewed checkpoint `55f83ef`.
