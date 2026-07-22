# LLM Provider Interface

## What Changed

- Added `@knowledge/generation` as the provider boundary for answer generation.
- Added provider-agnostic contracts for messages, generation results, model descriptors, usage metadata, and streaming events.
- Added `createOpenAIChatProvider()` for OpenAI-compatible chat completions.
- Added `createAnthropicMessagesProvider()` for Anthropic/Claude-compatible messages.
- Added `createStaticLlmProvider()` for deterministic tests and local fallback.
- Added coverage gates for the new package.

## Why

- Sprint 7 needs LLM generation behind one TypeScript interface before routing, evidence packing, prompt templates, streaming query APIs, and cost tracking can be wired.
- The interface keeps provider details out of retrieval/evidence code and preserves the project rule that external API providers stay behind TypeScript adapters.

## Performance And Safety Notes

- Message count, message byte size, output token budget, and provider response byte size are bounded.
- Streaming and non-streaming paths share the same input validation.
- Provider responses are Zod-validated and fail closed on non-2xx responses, malformed JSON, malformed payloads, oversized responses, and malformed stream events.
- The stream event surface emits only deltas and bounded metadata; it does not include API keys, raw request headers, JWTs, or full request bodies.

## Verification

- `pnpm install`
- `pnpm --filter @knowledge/generation test -- src/generation.test.ts`
- `pnpm --filter @knowledge/generation typecheck`
- `pnpm --filter @knowledge/generation test:coverage`
- `pnpm lint`

Full workspace verification is recorded in `TEMP-progress-document.md` after completion.

## Known Risks / Follow-Up

- This slice implements provider contracts and SDK-free HTTP wiring only; generation routing, evidence packing, prompt templates, SSE query endpoints, cost tracking, and citation normalization remain later Sprint 7 work.
- The HTTP payloads intentionally target stable OpenAI-compatible chat completions and Anthropic-compatible messages shapes; live provider integration tests are deferred until runtime secrets and provider selection are wired.
