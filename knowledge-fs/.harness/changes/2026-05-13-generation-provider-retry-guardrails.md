# Generation Provider Retry Guardrails

## What Changed

- Extended `GenerateTextInput` with optional `AbortSignal` support.
- Added generation HTTP provider retry configuration:
  - `maxRetries`
  - `retryDelayMs`
  - injectable `sleep(ms)` for deterministic tests.
- OpenAI-compatible and Anthropic-compatible generation providers now retry bounded retryable HTTP statuses (`408`, `409`, `425`, `429`, and `5xx`) before response parsing.
- Provider fetch calls now receive the caller's `AbortSignal` for both non-streaming and streaming requests.

## Why

- Continues R2 from `.harness/docs/code-review-remediation-iteration-plan.md`.
- Addresses the generation side of review issue L13 by adding retry/backoff and cancellation propagation.
- Keeps retries bounded and test-injected to avoid hidden latency or flaky tests.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation test:coverage`
- `pnpm typecheck`
- `pnpm lint`
- `git diff --check`

## Known Risks / Follow-Up

- Embedding and parser providers still need the same retry/abort contract.
- Structured provider error classes from L22 remain a follow-up within R2.
