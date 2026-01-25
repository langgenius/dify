## Purpose

Unit tests for plugin-backed `LargeLanguageModel.invoke()` behavior around preserving provider pass-through data.

## What it covers

- `AssistantPromptMessage.opaque_body` from plugin `LLMResultChunk` deltas is preserved:
  - On the returned `LLMResult` in blocking (`stream=False`) mode.
  - On the aggregated `LLMResult` passed to `on_after_invoke` callbacks in streaming mode.
- Streaming mode also verifies that `chunk.prompt_messages` is re-attached to the original request prompt messages.
- Streaming aggregation merges incremental `tool_calls` across chunks.

