# Parser Provider Retry Guardrails

## What Changed

- Extended parser document inputs with optional `AbortSignal` support.
- Added bounded retry configuration to the Unstructured parser client:
  - `maxRetries`
  - `retryDelayMs`
  - injectable `sleep(ms)`.
- The Unstructured client now rebuilds multipart `FormData` and `Request` on every retry attempt.
- Retryable statuses are bounded to `408`, `409`, `425`, `429`, and `5xx`.

## Why

- Completes the retry/abort provider reliability portion of R2 for parser IO.
- Avoids reusing consumed multipart request bodies while still supporting retries for transient provider failures.

## Verification

- `pnpm --filter @knowledge/parsers test -- src/parser.test.ts`
- `pnpm --filter @knowledge/parsers test:coverage`
- `pnpm typecheck`
- `pnpm lint`
- `git diff --check`

## Known Risks / Follow-Up

- R2 still needs structured provider error classes so callers can distinguish retry exhaustion, rate limits, validation, and malformed provider payloads programmatically.
