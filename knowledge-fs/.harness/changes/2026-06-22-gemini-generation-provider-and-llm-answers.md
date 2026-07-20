# Native Gemini Generation Provider + LLM Answer Synthesis

## What Changed

- Added `createGeminiGenerativeProvider` to `@knowledge/generation`, calling Google's native `POST /v1beta/models/{model}:generateContent` (and `:streamGenerateContent?alt=sse` for streaming) endpoints. Authenticates with the `x-goog-api-key` header.
  - Request bodies map chat messages to Gemini's `contents` shape: `system` messages are hoisted into `systemInstruction`, `assistant` turns become `role: "model"`, everything else `role: "user"`; `maxOutputTokens`/`temperature` go under `generationConfig`.
  - Responses parse `candidates[0].content.parts[].text` (joined), `finishReason`, `modelVersion`, and map `usageMetadata` (`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`) into the shared `LlmUsage`. Streaming reuses the existing SSE reader and emits a terminal `done` event carrying the last `finishReason`/usage.
  - Registered default generative models `gemini-2.5-flash` and `gemini-2.5-pro`.
- Extended `LlmProviderKind` and the `LlmCostBreakdown`/`LlmGenerationMetadata` provider enums to include `gemini` (additive; existing providers unaffected).
- Added `createLlmAnswerQueryGenerator` to `@knowledge/api`: an LLM-backed `QueryGenerator` that embeds the query, runs the same layered retriever + evidence-bundle assembly as the extractive generator, then streams a grounded answer from an injected provider with a cite-only-from-evidence system prompt. Falls back to a `no-retrieval-evidence` notice when retrieval is empty (the LLM is never called without evidence), caps streamed output at `maxAnswerChars`, and emits `metadata.generator = "llm-answer"` with citations, evidence bundle, plan, metrics, and provider finish reason. The provider is a **structural** interface, so `@knowledge/api` keeps no dependency on `@knowledge/generation`.
- Added a shared `apps/api/src/generation-provider.ts` (`createChatProvider` + env helpers) building the concrete OpenAI/Anthropic/Gemini chat provider for a kind, reused by both semantic extraction and answer wiring.
- Wired `gemini` into semantic extraction (`createApiSemanticEntityExtractionOptions`): selectable via `KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER=gemini` (explicit-only — `GEMINI_API_KEY` alone does **not** auto-enable, since it is also the embedding key). OpenAI/Anthropic auto-detect is unchanged.
- Added a separate, explicit answer knob `createApiAnswerGenerationOptions` (`KNOWLEDGE_ANSWER_PROVIDER` = `openai|anthropic|gemini|off`, default unset → extractive answers preserved; `KNOWLEDGE_ANSWER_MODEL`, `KNOWLEDGE_ANSWER_MAX_OUTPUT_TOKENS`). `apps/api` selects `createLlmAnswerQueryGenerator` when configured, otherwise the existing `createHybridQueryGenerator`.
- Added `KNOWLEDGE_ANSWER_*` passthrough to `infra/local/compose.yaml` and the env example; enabled `KNOWLEDGE_ANSWER_PROVIDER=gemini` in the local `infra/local/.env`.

## Why

- User request: make Gemini usable as the RAG **reasoning/generation** model, not only embeddings. Previously the generation layer supported only `openai`/`anthropic`/`static`, and the query answer path was purely extractive — Gemini was wired for embeddings alone.
- Answer synthesis is gated behind its own knob so enabling semantic extraction (or merely holding an OpenAI/Anthropic key) never silently flips the answer endpoint from extractive to LLM-generated.

## Verification

- `pnpm --filter @knowledge/generation test` (48 passed; new `createGeminiGenerativeProvider` generate/stream/role-mapping/fail-closed cases)
- `pnpm --filter @knowledge/api test` (611 passed; new `llm-answer-query-generator.test.ts`)
- `pnpm --filter @knowledge/api-app test` (49 passed; new `answer-generation-options.test.ts`, extended `llm-options.test.ts`)
- `pnpm typecheck` (generation, api, api-app)
- `pnpm lint` (biome, changed files)
- `node --test scripts/compose-apps.test.mjs scripts/compose-middleware.test.mjs`

## Known Risks / Follow-Up

- The structural `LlmAnswerProvider` (stream-only) is satisfied by `@knowledge/generation`'s `LlmProvider`; if that package's stream event shape diverges, the structural contract in `@knowledge/api` must be updated in lockstep.
- Gemini `generateContent` blocked by safety returns no candidates → an empty answer (citations/evidence still attached); no automatic extractive fallback is performed in that case.
- Enabling Gemini answers in the running stack requires rebuilding the `api` image (code change) and restarting with `KNOWLEDGE_ANSWER_PROVIDER=gemini`.
- Generation cost tracking pricing is not registered for Gemini models; cost estimation for `gemini-*` would throw if the optional cost tracker is enabled (the answer path does not enable it).
