# Embedding Provider Retry Guardrails

## What Changed

- Extended embedding and reranker inputs with optional `AbortSignal` support.
- Added bounded retry configuration to HTTP embedding and reranker providers:
  - `maxRetries`
  - `retryDelayMs`
  - injectable `sleep(ms)`.
- HTTP embedding and reranker providers now rebuild requests on each retry so JSON request bodies are not reused after a failed attempt.
- Retryable statuses are bounded to `408`, `409`, `425`, `429`, and `5xx`.

## Why

- Continues R2 from `.harness/docs/code-review-remediation-iteration-plan.md`.
- Addresses the embedding/reranker side of review issue L13 with bounded retry/backoff and cancellation propagation.
- Keeps request body handling safe for real fetch implementations by creating a fresh `Request` per attempt.

## Verification

- `pnpm --filter @knowledge/embeddings test -- src/embedding.test.ts`
- `pnpm --filter @knowledge/embeddings test:coverage`
- `pnpm typecheck`
- `pnpm lint`
- `git diff --check`

## Known Risks / Follow-Up

- Parser provider retry/abort and structured provider error classes from L22 remain in R2.
