# Claim-Evidence Alignment Check

## What Changed

- Added `ClaimEvidenceAlignmentChecker` contracts and report models in `@knowledge/generation`.
- Added `createClaimEvidenceAlignmentChecker()` for bounded rule-based fast-mode validation.
- Added `createLlmClaimEvidenceAlignmentJudge()` for deep/research-mode judge checks through the existing `LlmProvider` interface.
- Alignment reports now contain:
  - Every extracted claim.
  - Ungrounded claims.
  - Evidence markers and node ids.
  - Reason codes such as `missing-citation` and `citation-without-evidence-overlap`.
  - Checker metadata including mode, checker kind, checked claim count, evidence reference count, and judge model when applicable.

## Why

- Sprint 16 requires post-generation verification so ungrounded claims can be detected before hallucination/freshness flags are surfaced.
- The rule-based checker gives fast mode a local, cheap guard.
- The LLM judge boundary gives deep/research modes a provider-backed path without coupling generation post-processing to a concrete model vendor.

## Performance Notes

- Rule-based alignment is linear over bounded claims and packed evidence; it performs no database, network, cache, or filesystem calls.
- LLM judge input is bounded by `maxAnswerBytes`, `maxClaimBytes`, `maxClaims`, `maxEvidenceBytes`, and `maxOutputTokens`.
- The LLM judge performs exactly one provider call per alignment check.
- The checker clones normalized citation and packed evidence inputs so callers cannot mutate internal report state.

## Verification

- RED first:
  - `pnpm --filter @knowledge/generation test -- src/generation.test.ts --runInBand` failed because the checker factories did not exist.
  - `pnpm --filter @knowledge/generation test:coverage` failed at 89.14% branch coverage until additional guard tests were added.
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

- This slice builds the reusable alignment boundary; the next Sprint 16 slice should wire the report into response metadata as hallucination/freshness flags.
- Rule-based overlap is intentionally conservative and should be augmented by the LLM judge for deep/research generation.
