## Purpose

`core/model_runtime/model_providers/__base/large_language_model.py` defines the base `LargeLanguageModel` interface used
by model providers, including plugin-backed providers via `PluginModelClient`.

## Plugin invocation flow

- For plugin-based providers, `invoke()` delegates to `PluginModelClient.invoke_llm(...)`, which streams
  `LLMResultChunk` objects from the plugin daemon.
- Dify yields chunks to callers and also aggregates chunks to fire `after_invoke` callbacks (and to construct a
  blocking `LLMResult` when `stream=False`).

## Key invariants / edge cases

- When aggregating chunks into an `LLMResult`, preserve provider-specific fields on the assistant message:
  - `AssistantPromptMessage.opaque_body` (pass-through, uninterpreted JSON).
  - Incremental `tool_calls` (merge deltas via `_increase_tool_call`).
- Chunk `.prompt_messages` may be empty for plugin responses (compat layer for the plugin daemon); Dify re-attaches the
  original request `prompt_messages` for downstream consumers.

