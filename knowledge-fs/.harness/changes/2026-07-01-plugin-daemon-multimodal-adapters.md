# Plugin-daemon Model Routing — Phase 4 (multimodal answer + enrichment)

Date: 2026-07-01

## Context

Adds plugin-daemon routing for the two VLM seams (multimodal answer + document multimodal
enrichment). Both are vision LLM calls, so they use the daemon `llm` op with image content blocks in
`prompt_messages`, reusing the SSE stream aggregation.

## What Changed

- **Tenant threading (Phase 1 completion for this path)**: `GenerateMultimodalAnswerContentInput`
  and `GenerateMultimodalAnswerTextInput` (`packages/api/src/llm-multimodal-answer-provider.ts`) gain
  `tenantId?`; the content/text answer providers forward `input.tenantId` to their injected provider.
- **Shared helper**: `pluginDaemonLlmCompletion` in `apps/api/src/plugin-daemon-options.ts`
  dispatches the `llm` op with caller-built `prompt_messages` and aggregates the SSE stream into
  `{text, finishReason?, model?}`.
- **Multimodal answer** (`apps/api/src/multimodal-answer-options.ts`):
  `KNOWLEDGE_MULTIMODAL_ANSWER_PROVIDER=plugin-daemon` injects a plugin-daemon
  `MultimodalAnswerContentProvider` into the existing object-storage content-block builder; it maps
  `LlmMultimodalContentBlockMessage[]` → `prompt_messages` (text + image_url parts) and calls the
  daemon. Config: `KNOWLEDGE_MULTIMODAL_ANSWER_PLUGIN_ID/_PLUGIN_PROVIDER/_MODEL`.
- **Multimodal enrichment** (`apps/api/src/multimodal-enrichment-options.ts`):
  `KNOWLEDGE_MULTIMODAL_ENRICHMENT_PROVIDER=plugin-daemon` builds a plugin-daemon
  `DocumentMultimodalUnderstandingProvider` that reuses the existing `understandingMessages`
  (image-loading + content parts) and `parseUnderstandingResult`, calling the daemon `llm` op.
  Config: `KNOWLEDGE_MULTIMODAL_ENRICHMENT_PLUGIN_ID/_PLUGIN_PROVIDER/_MODEL`.
- Credentials default to `{}` (daemon-resolved); `*_PLUGIN_CREDENTIALS_JSON` escape hatch; per-call
  tenant required.

## Why

Completes the core capability coverage (text embedding, rerank, LLM, and now VLM answer + enrichment)
for plugin-daemon routing.

## Known Risk / Assumption (IMPORTANT — verify)

- The multimodal **content-part serialization** for `prompt_messages` is assumed OpenAI-compatible
  (`{type:"text",text}` / `{type:"image_url",image_url:{url,detail}}`). Dify's plugin-daemon uses
  `jsonable_encoder(prompt_messages)` over its `PromptMessageContent` entities, whose exact
  multimodal shape is version-specific and was NOT verifiable from the current dify checkout (the
  model-runtime entities have moved). The mapping is isolated in `toPluginDaemonContentPart`
  (answer) and produced by `understandingMessages` (enrichment) — **verify/adjust against the
  deployed dify/plugin-daemon version** before relying on image inputs. Text-only prompts are
  unaffected.

## How It Was Verified

- Reasoned-verified only (no Node runtime here). Requires `pnpm install` + `pnpm check`. The apps/api
  multimodal adapters are wiring-level (no coverage gate); an integration smoke against a stub daemon
  is a recommended follow-up, along with confirming the content-part format above.
