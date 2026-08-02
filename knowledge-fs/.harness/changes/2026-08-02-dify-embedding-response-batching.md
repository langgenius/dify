# Dify embedding response-bounded batching

Date: 2026-08-02

## What changed

- The Dify model-runtime embedding provider still accepts the workspace-wide caller batch of up
  to 128 texts, but now splits that work into sequential Dify requests of at most 16 texts.
- Subrequest results are reassembled in input order, token usage is summed, and embedding
  dimensions are validated both within and across subrequests.
- Abort signals are checked and forwarded for every subrequest.
- The synthesized Dify model descriptor now recommends the response-safe 16-item request size.
- Added regression coverage for the exact 81-chunk shape produced by the reported document. The
  test proves it becomes `16 + 16 + 16 + 16 + 16 + 1`, preserves vector order, and aggregates
  usage.
- No API contract, database schema, migration, frontend, or deployment configuration changed.

## Why

The supplied `权责蓝图.html` is 102,516 bytes, but its parsed model input is small: the native
HTML parser produces 172 elements and compilation produces 81 chunks totaling 10,640 characters
(28,179 UTF-8 bytes). This rules out the upload body and embedding input text as the timeout
cause.

Before this change all 81 chunks were sent through Dify in one embedding request. A representative
serialized response containing 81 OpenAI 3072-dimensional vectors is approximately 5.47 MiB,
which exceeds plugin-daemon's default 5 MiB stdio buffer. This matches the previously observed
OpenAI plugin subprocess restart: the oversized response terminates the plugin transport, and the
KnowledgeFS client later surfaces the secondary symptom `Dify model runtime request timed out` at
its 60-second deadline.

The earlier durable-retry fix preserved `retryable: true`, but each retry sent the same oversized
81-item request, so it could not remove this deterministic failure. This change addresses the
request shape that causes the process restart instead of increasing the timeout or repeating the
same payload.

## Performance and resource bounds

- The reported document now needs six bounded model-runtime calls, not 81 single-item calls.
- A representative 16-vector response is approximately 1.08 MiB, leaving substantial headroom
  below the 5 MiB daemon buffer and the model client's 8 MiB response limit.
- Subrequests execute sequentially so only one embedding response is buffered at a time and the
  plugin subprocess is not subjected to a burst of concurrent large responses.
- The caller-facing maximum remains 128, preserving compilation batching and preventing an N+1
  embedding path.
- The tradeoff is additional round-trip latency for large batches; avoiding plugin restarts,
  60-second timeouts, and whole-compilation retries is the safer and faster end-to-end behavior.

## Verification

- TDD red phase:
  - Added the 81-chunk regression with a fake Dify transport that reproduces
    `Dify model runtime request timed out` whenever a request exceeds 16 texts.
  - `pnpm --filter @knowledge/embeddings exec vitest run
    src/dify-model-runtime-embedding.test.ts` failed because the old provider sent all 81 texts in
    one request.
- Green phase:
  - Focused Dify provider tests: 1 file, 8 tests passed.
  - Full embeddings tests: 4 files, 29 tests passed.
  - Embeddings coverage passed: 94.72% lines/statements, 91.62% branches, 94.11% functions.
  - Compilation integration tests: 2 files, 43 tests passed.
  - API app embedding wiring tests: 1 file, 8 tests passed.
  - Embeddings typecheck and focused Biome checks passed.
- `pnpm check` passed, including workspace tests, coverage gates, evaluations, migration and
  contract checks, Docker/Compose validation, and smoke-test definitions.
- `pnpm build` passed for all 12 packages.
- `pnpm lint` remains blocked by 10 pre-existing repository-wide findings in unchanged Admin,
  test-fixture, OpenAPI, and generated capability-contract files. The two changed source/test
  files pass the focused Biome check.

## Runtime validation and rollout

- The supplied document was parsed and compiled locally through the real parser/compute path; it
  was not copied into the repository.
- A live Dify model invocation was not available because the local Docker services and provider
  credentials are not running in this workspace. The transport boundary is covered
  deterministically by the regression test.
- The KnowledgeFS API image/process must be rebuilt and redeployed before retesting. Any attempt
  already terminalized by the previous deployment needs a manual retry or re-upload after rollout.

