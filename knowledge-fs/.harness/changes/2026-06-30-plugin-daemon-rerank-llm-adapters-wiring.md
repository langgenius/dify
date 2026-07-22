# Plugin-daemon Model Routing — Phase 2 Wiring + Phase 3 (rerank + LLM)

Date: 2026-06-30

## Context

Continues the plugin-daemon model-routing work (Phases 0–1 already landed). This adds the rerank and
LLM adapters and wires plugin-daemon as a selectable provider kind for embedding, rerank, and LLM
(answer + semantic extraction).

## What Changed

### Adapters
- `packages/embeddings/src/index.ts`: `createPluginDaemonRerankerProvider` (RerankerProvider over the
  daemon `rerank` op; daemon returns scored indices, matched back to documents by index; kind
  `"plugin-daemon"`). Tests in `src/plugin-daemon-rerank.test.ts`.
- `packages/generation/src/index.ts`: `createPluginDaemonLlmProvider` (LlmProvider over the daemon
  `llm` SSE op; `stream` maps `delta.message.content` → `{delta}` then a `{done}` event with usage;
  `generate` aggregates; kind `"plugin-daemon"`). Vision uses the same op via image content blocks.
  Tests in `src/plugin-daemon-llm.test.ts`. Added `@knowledge/plugin-daemon-client` dependency.

### Wiring (`apps/api`)
- New `apps/api/src/plugin-daemon-options.ts`: builds the shared `PluginDaemonClient` from
  `PLUGIN_DAEMON_URL`/`PLUGIN_DAEMON_KEY` (+ optional max-bytes/retries), plus helpers
  (`pluginDaemonRequired`, `parsePluginDaemonCredentials`).
- `embedding-options.ts`, `reranker-options.ts`: `KNOWLEDGE_{EMBEDDING,RERANK}_PROVIDER=plugin-daemon`
  builds the daemon adapter from `KNOWLEDGE_{EMBEDDING,RERANK}_PLUGIN_ID` / `_PLUGIN_PROVIDER` /
  `_MODEL` (+ optional `_PLUGIN_CREDENTIALS_JSON`).
- `generation-provider.ts`: `createChatProvider` gains a `plugin-daemon` kind taking per-capability
  config; `answer-generation-options.ts` (`KNOWLEDGE_ANSWER_PROVIDER`) and `llm-options.ts`
  (`KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER`, shared by entity/relation/community) pass their resolved
  `pluginId`/`provider`/`model`/credentials.
- Credentials default to `{}` (daemon-resolved); `*_PLUGIN_CREDENTIALS_JSON` is the escape hatch.

## Why

Completes the selectable plugin-daemon routing for the core capabilities (text embedding, rerank,
LLM answer + semantic extraction) on top of the per-request tenant threading from Phase 1.

## How It Was Verified

- TDD for the adapters; reasoned-verified only (no Node runtime here). Requires `pnpm install` (new
  workspace deps in `embeddings`/`generation`/`api-app`), then `pnpm check`. Coverage for the new
  adapter branches should be confirmed (packages enforce ≥90%).

## Known Gaps / Follow-up

- Visual **text-query** embedding (`visual-embedding-options.ts`) still uses its HTTP provider; it
  could route through the daemon `text_embedding` op later. Image-byte visual embedding has no daemon
  model type (Phase 5 exception).
- Multimodal answer/enrichment adapters are Phase 4.
- apps/api options wiring has no unit tests here (the app test script is `--passWithNoTests`); a smoke
  test selecting `plugin-daemon` per capability is a recommended follow-up.
