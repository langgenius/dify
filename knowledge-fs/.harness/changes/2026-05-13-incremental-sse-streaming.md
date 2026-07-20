# Incremental SSE Streaming Remediation

## What Changed

- Added `.harness/docs/code-review-remediation-iteration-plan.md` to split the remaining `docs/code-review-issues.md` findings into executable TDD iterations.
- Reworked LLM provider SSE consumption to parse provider streams incrementally instead of reading the full response before yielding.
- Preserved multi-line `data:` semantics and added parser support for SSE `id` and `retry` fields.
- Added a regression test proving the first OpenAI-compatible stream delta is yielded before the provider response closes.

## Why

- Addresses remaining review issue M6: provider streaming was not truly incremental, which could block long-running generation responses until completion and increase perceived latency.
- Keeps max-response-byte bounds and cancellation behavior intact while improving streaming correctness.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation test:coverage`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm check`
- `git diff --check`

## Known Risks / Follow-Up

- Provider retry/backoff and `AbortSignal` support remain in the next remediation iteration.
- This slice does not yet introduce a shared provider error hierarchy.
