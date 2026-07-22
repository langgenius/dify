# Remove direct chat-provider adapters from @knowledge/generation (slice 2 of 2)

Date: 2026-07-02

## Context

Second and final slice of the direct-provider removal (slice 1 was `@knowledge/embeddings`). The
apps/api wiring routes all LLM calls through the plugin-daemon, so the vendor SDK chat providers in
`@knowledge/generation` are unused library code. Removed.

## What Changed (`packages/generation/src/index.ts`, 3752 → 2809 lines)

Deleted the direct chat providers and everything exclusive to them:
- Factories: `createOpenAIChatProvider`, `createAnthropicMessagesProvider`,
  `createGeminiGenerativeProvider`.
- Options: `HttpLlmProviderOptions`, `AnthropicMessagesProviderOptions`.
- Vendor response schemas (OpenAI chat + stream, Anthropic messages + stream, Gemini) and vendor
  model lists (`openAIModels`, `anthropicModels`, `geminiGenerativeModels`).
- The shared HTTP/SSE engine used only by them: `fetchWithRetries`, `isRetryableProviderStatus`,
  `providerRequestError`, `validateRuntimeOptions`, request builders
  (`openAI/anthropic/geminiRequestBody`), response readers (`readJsonResponse`, `readTextResponse`),
  the SSE pipeline (`readSseEvents`, `parseSseEvents`, `createSseParseState`, `consumeSseLine`,
  `flushSseEvent`, `trimLineEnding`, `SseEvent`, `SseParseState`), payload parsers
  (`parseProviderPayload`, `parseStreamPayload`), usage mappers (`openAI/anthropic/geminiUsage`),
  and `trimTrailingSlash`.
- Dead error classes `ProviderRequestError` / `ProviderRateLimitError` (only the deleted HTTP path
  threw them; the `@knowledge/parsers` copies are separate) and their `ProviderErrorCode` members.

Kept: `createPluginDaemonLlmProvider`, `createStaticLlmProvider`, `validateGenerateInput`,
`ProviderRuntimeOptions`, `sleepMs`, `cloneModels`, `ProviderError`/`ProviderInputError`/
`ProviderResponseError`, and the entire generation-orchestration surface (cost tracker, LLM router,
context-window packer, citation normalizer, claim/evidence judge, quality flagger, golden-question
generator + review workflow, generation cache + skip path).

## Deliberate decision: `LlmProviderKind` stays wide

`LlmProviderKind` is left as `"anthropic" | "gemini" | "openai" | "plugin-daemon" | "static"` (not
narrowed). The kept cost/routing schemas hardcode `z.enum(["anthropic","gemini","openai","static"])`
(`LlmCostBreakdownSchema`, `LlmRoutingMetadataSchema`) and `generationPriceKey` /
`GenerationModelPrice` are keyed by these provider names, so narrowing the union would break the
cost/routing/pricing subsystem and its persisted-record contracts. No provider factory now *produces*
those kinds; the literals remain only as accepted values in the cost/routing types. Narrowing them is
a separate concern tied to the cost model, out of scope for the adapter removal.

## Tests (`generation.test.ts`, 3085 → 2120 lines)

Removed the OpenAI/Anthropic direct-provider `it` blocks, the entire `createGeminiGenerativeProvider`
describe, the now-unused fetch stubs (`RecordedRequest`, `createJsonFetch`, `createSseFetch`,
`createStreamingTextFetch`, `createDelayedSseFetch`), and the orphaned imports (the three factories,
`ProviderRateLimitError`, `ProviderInputError`, `ProviderResponseError`). Kept every other suite
(static provider, cost tracker, router, packer, judge, citation, quality, golden questions, cache).
The plugin-daemon LLM adapter has its own suite (`plugin-daemon-llm.test.ts`), unchanged.

## Verification

- Grepped source + test: no dangling references to any deleted symbol; all remaining imports and
  trailing fixtures still used; 3 describes close cleanly; parens balanced (the off-by-one raw brace
  count is the `encode("{")` string literal).
- No Node runtime here — **must run** `pnpm --filter @knowledge/generation test` and `pnpm check`
  (confirm the ≥90% coverage gate; removed code and its tests were dropped together).
