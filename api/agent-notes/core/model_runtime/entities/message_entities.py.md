## Purpose

`core/model_runtime/entities/message_entities.py` defines the canonical in-memory Pydantic entities for model runtime
prompt messages and multi-modal message content. These entities are used across providers (built-in and plugin-backed)
and are serialized/deserialized when exchanging prompt/response payloads between layers.

## Key invariants

- `PromptMessage.content` is either a `str`, a list of typed content items (discriminated by `type`), or `None`.
- `PromptMessage.validate_content` normalizes dict/content-model inputs into the correct concrete content classes using
  `CONTENT_TYPE_MAPPING`.
- `PromptMessage.serialize_content` ensures a list of content items is emitted as a list of plain dicts.
- `AssistantPromptMessage.tool_calls` may coexist with text/multi-modal content and is considered part of "non-empty".

## Opaque pass-through fields

- `opaque_body` is an optional JSON value on `PromptMessageContent` and `AssistantPromptMessage`.
- It is treated as an uninterpreted provider-specific payload and must be passed through unchanged between Dify and
  plugin LLM providers (no validation/transformation beyond JSON serialization).

## Safety / compatibility notes

- Do not make `opaque_body` required; existing providers/plugins may not send it.
- Keep `type` discrimination stable; content subclasses must continue to be selectable via `Field(discriminator="type")`.

