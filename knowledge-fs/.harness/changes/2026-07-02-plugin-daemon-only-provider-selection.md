# Provider Selection: plugin-daemon Only (remove direct providers + API-key auto-detect)

Date: 2026-07-02

## Context

knowledge-fs runs as a Dify subproject and always invokes models through the plugin-daemon. The
apps/api options previously auto-selected a direct SDK provider (OpenAI/Cohere/Voyage/Gemini/
Anthropic) from the presence of an API key (e.g. `!providerName && hasText(env.OPENAI_API_KEY)`) and
accepted those provider names explicitly. Per the maintainer, that logic is dead weight and
misleading; the daemon is the only path.

## What Changed (apps/api options)

- Removed all direct-provider branches, their `*_API_KEY` / `*_BASE_URL` / `OPENAI_MODEL` env, the
  API-key auto-detection, and the OpenAI multimodal HTTP wrappers.
- Recognized provider values are now: `plugin-daemon`, `off`, and `static` (embedding + reranker
  only, for tests).
- Defaults:
  - **embedding / reranker** (retrieval core): unset → `plugin-daemon` (requires
    `KNOWLEDGE_*_PLUGIN_ID` / `_PLUGIN_PROVIDER`; throws a clear config error if missing). `off`
    disables; `static` is available for tests.
  - **answer / semantic extraction / multimodal answer / multimodal enrichment** (opt-in features):
    unset → disabled; only `plugin-daemon` enables them. The deliberate opt-in gates are preserved
    (notably semantic extraction stays off by default — it is expensive and previously opt-in).
- `generation-provider.ts` `createChatProvider` is now plugin-daemon-only (`(env, pluginDaemon)`);
  removed `ChatProviderKind`, `DEFAULT_MODEL`, `hasText`, and the OpenAI/Anthropic/Gemini builders.
- `llm-options.ts` dropped `resolveProviderKind` (the OPENAI/ANTHROPIC key auto-detect).

## Why

- Removes surprising key-based auto-selection and unused direct-provider wiring; makes the provider
  path explicit and consistent (plugin-daemon), matching how knowledge-fs is deployed.

## Deliberate deviation (documented)

- I did **not** force-enable the opt-in capabilities (answer, semantic extraction, multimodal). The
  maintainer chose "default = plugin-daemon"; I applied that to embedding/reranker but kept
  answer/semantic/multimodal opt-in, because defaulting semantic extraction to on would run
  expensive entity/relation extraction on every ingest — a behavior change beyond the provider
  cleanup and contrary to the existing explicit-opt-in design. Flag if force-on is actually wanted.
- The direct-provider **adapters** still exist as unused exports in `@knowledge/embeddings` /
  `@knowledge/generation` (with their own tests); only the apps/api wiring stopped using them.
  Pruning those library adapters is a separate, larger change.

## How It Was Verified

- Updated all six options test suites (`{embedding,reranker,answer-generation,llm,multimodal-answer,
  multimodal-enrichment}-options.test.ts`) to the plugin-daemon-only behavior (default routing,
  static/off, missing-config errors; multimodal tests drive a stubbed daemon SSE via global fetch).
- Reasoned-verified only — no Node runtime here. Run `pnpm --filter @knowledge/api-app test` and
  `pnpm check`.
