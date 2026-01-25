# Notes: `large_language_model.py`

## Purpose

Provides the base `LargeLanguageModel` implementation used by the model runtime to invoke plugin-backed LLMs and to
bridge plugin daemon streaming semantics back into API-layer entities (`LLMResult`, `LLMResultChunk`).

## Key behaviors / invariants

- `invoke(..., stream=False)` still calls the plugin in streaming mode and then synthesizes a single `LLMResult` from
  the first yielded `LLMResultChunk`.
- Plugin invocation is wrapped by `_invoke_llm_via_plugin(...)`, and `stream=False` normalization is handled by
  `_normalize_non_stream_plugin_result(...)` / `_build_llm_result_from_first_chunk(...)`.
- Tool call deltas are merged incrementally via `_increase_tool_call(...)` to support multiple provider chunking
  patterns (IDs anchored to first chunk, every chunk, or missing entirely).
- A tool-call delta with an empty `id` requires at least one existing tool call; otherwise we raise `ValueError` to
  surface invalid delta sequences explicitly.
- Callback invocation is centralized in `_run_callbacks(...)` to ensure consistent error handling/logging.
- For compatibility with dify issue `#17799`, `prompt_messages` may be removed by the plugin daemon in chunks and must
  be re-attached in this layer before callbacks/consumers use them.
- Callback hooks (`on_before_invoke`, `on_new_chunk`, `on_after_invoke`, `on_invoke_error`) must not break invocation
  unless `callback.raise_error` is true.

## Test focus

- `api/tests/unit_tests/core/model_runtime/__base/test_increase_tool_call.py` validates tool-call delta merging and
  patches `_gen_tool_call_id` for deterministic IDs.
