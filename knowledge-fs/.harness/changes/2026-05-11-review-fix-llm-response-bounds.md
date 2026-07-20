# Review Fix: Bounded LLM Response Reading

## What Changed

- Replaced post-hoc LLM provider response size checks with streaming bounded reads.
- `readTextResponse()` now checks `response.ok` before reading provider bodies.
- Successful provider responses are read chunk by chunk and canceled as soon as `maxResponseBytes` is exceeded.
- Added a regression test that uses a streaming `Response` and verifies the stream is canceled instead of being consumed past the configured byte limit.

## Why

- The 10-commit health review found that `response.text()` loaded the full LLM provider response before enforcing `maxResponseBytes`.
- That behavior could retain oversized provider responses in memory and violated the project performance rule against unbounded reads.

## Performance And Safety Notes

- Oversized provider responses now fail as soon as the cumulative byte count crosses `maxResponseBytes`.
- Error responses fail before reading potentially large bodies.
- The change does not alter request payloads, routing policy, provider credentials, or generation output mapping.

## Verification

- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation test:coverage`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`
