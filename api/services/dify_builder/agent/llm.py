"""LLM helpers for the Dify Builder agent.

Blocking calls are fine — advances run in a Celery worker. Chat replies expose
the model's native stream while structured cognition remains blocking.
``invoke_json`` mirrors the repo's hardened
WorkflowGenerator._invoke_and_parse_json: parse with json_repair, and on
failure retry ONCE with a corrective hint before raising.
"""

from collections.abc import Callable, Generator, Iterator, Mapping
from typing import Any, cast

import json_repair
from pydantic import BaseModel

from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from graphon.model_runtime.entities.message_entities import (
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.nodes.llm.reasoning import ThinkStreamFilter, split_reasoning
from services.dify_builder import trace_diagnostics as diagnostics

# --- Reply-language instruction (M1) -----------------------------------------
# Appended to user-facing prompts so generated prose adopts the user's input
# language. Callers with a persisted session locale must use that explicitly:
# technical JSON and schema corrections are not evidence of the user's language.
LANGUAGE_INSTRUCTION = " Always write your reply in the same language as the user's input."


def json_language_instruction(fields: str, *, reply_language: str | None = None) -> str:
    """Language instruction for a JSON-emitting prompt: localize only the named
    human-readable field(s); keep JSON keys and enum values in English."""
    if reply_language:
        return (
            f" Write the {fields} in the session reply language (BCP-47: {reply_language}). "
            "This language takes precedence over the language of technical JSON, graph configuration, "
            "examples and schema-correction feedback. Write explanatory text and each plan step as "
            "natural-language prose in that language, not as English engine commands. "
            "Keep JSON keys, enum values, code, resource IDs, selectors and literal business values unchanged."
        )
    return (
        f" Write the {fields} in the same language as the user's input; keep all JSON keys and enum values in English."
    )


class LlmError(Exception):
    """The model did not return usable output (e.g. non-JSON after one retry)."""


ReasoningCallback = Callable[[str], None]


def _direct_reasoning(value: object) -> str:
    """Read provider-native reasoning without recursively scanning answer text."""
    sources: tuple[Mapping[str, object], ...]
    if isinstance(value, BaseModel):
        sources = (value.model_dump(), value.model_extra or {})
    elif isinstance(value, Mapping):
        sources = (cast(Mapping[str, object], value),)
    else:
        return ""
    for source in sources:
        for key in ("reasoning_content", "reasoning", "reasoningContent"):
            reasoning = source.get(key)
            if isinstance(reasoning, str) and reasoning:
                return reasoning
    return ""


def _emit_reasoning(callback: ReasoningCallback | None, reasoning: str) -> None:
    if callback is not None and reasoning:
        callback(reasoning)


def _complete(model_instance, messages, model_parameters, stop, on_reasoning: ReasoningCallback | None) -> str:
    try:
        result = model_instance.invoke_llm(
            prompt_messages=messages, model_parameters=model_parameters or {}, stop=stop, stream=False
        )
    except Exception as exc:
        diagnostics.report("provider_invocation_failed", error=exc)
        raise
    native_reasoning = _direct_reasoning(result)
    _emit_reasoning(on_reasoning, native_reasoning)
    try:
        get_text_content = result.message.get_text_content
    except AttributeError:
        diagnostics.report("response_schema_invalid")
        raise LlmError("model returned an invalid blocking response") from None
    if not callable(get_text_content):
        diagnostics.report("response_schema_invalid")
        raise LlmError("model returned an invalid blocking response")
    clean_text, tagged_reasoning = split_reasoning(get_text_content(), "separated")
    if tagged_reasoning and tagged_reasoning != native_reasoning:
        _emit_reasoning(on_reasoning, tagged_reasoning)
    if not clean_text.strip():
        diagnostics.report("empty_response")
    return clean_text


def _as_dict(text: str) -> dict[str, Any] | None:
    try:
        value = json_repair.loads(text)
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def invoke_text(
    model_instance,
    *,
    system: str,
    user: str,
    model_parameters: dict[str, Any] | None = None,
    stop: list[str] | None = None,
    on_reasoning: ReasoningCallback | None = None,
) -> str:
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    return _complete(model_instance, messages, model_parameters, stop, on_reasoning)


def invoke_text_stream(
    model_instance,
    *,
    system: str,
    user: str,
    model_parameters: dict[str, Any] | None = None,
    stop: list[str] | None = None,
    on_reasoning: ReasoningCallback | None = None,
) -> Iterator[str]:
    """Yield answer deltas while routing model reasoning to its own callback."""
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    try:
        result = model_instance.invoke_llm(
            prompt_messages=messages,
            model_parameters=model_parameters or {},
            stop=stop,
            stream=True,
        )
    except Exception as exc:
        diagnostics.report("provider_invocation_failed", error=exc)
        raise
    if isinstance(result, LLMResult):
        native_reasoning = _direct_reasoning(result)
        _emit_reasoning(on_reasoning, native_reasoning)
        text, tagged_reasoning = split_reasoning(result.message.get_text_content(), "separated")
        if tagged_reasoning and tagged_reasoning != native_reasoning:
            _emit_reasoning(on_reasoning, tagged_reasoning)
        if text:
            yield text
        return

    think_filter = ThinkStreamFilter()
    for chunk in _stream_chunks(cast(Generator[LLMResultChunk], result)):
        native_reasoning = next(
            (
                reasoning
                for value in (chunk, chunk.delta, chunk.delta.message)
                if (reasoning := _direct_reasoning(value))
            ),
            "",
        )
        _emit_reasoning(on_reasoning, native_reasoning)
        content = chunk.delta.message.content
        if isinstance(content, str):
            delta = content
        elif isinstance(content, list):
            delta = "".join(
                part.data if isinstance(part, TextPromptMessageContent) else part
                for part in cast(list[object], content)
                if isinstance(part, (TextPromptMessageContent, str))
            )
        else:
            delta = ""
        for piece in think_filter.feed(delta):
            if piece.kind == "reasoning":
                _emit_reasoning(on_reasoning, piece.chunk)
            elif piece.chunk:
                yield piece.chunk
    for piece in think_filter.finalize():
        if piece.kind == "reasoning":
            _emit_reasoning(on_reasoning, piece.chunk)
        elif piece.chunk:
            yield piece.chunk


def _stream_chunks(result: Iterator[LLMResultChunk]) -> Iterator[LLMResultChunk]:
    try:
        yield from result
    except Exception as exc:
        diagnostics.report("provider_invocation_failed", error=exc)
        raise


def invoke_json(
    model_instance,
    *,
    system: str,
    user: str,
    model_parameters: dict[str, Any] | None = None,
    stop: list[str] | None = None,
    on_reasoning: ReasoningCallback | None = None,
) -> dict[str, Any]:
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    text = _complete(model_instance, messages, model_parameters, stop, on_reasoning)
    parsed = _as_dict(text)
    if parsed is not None:
        return parsed
    diagnostics.report("json_decode_failed", attempt=1)
    messages.append(
        UserPromptMessage(
            content=(
                f"Your previous reply was not valid JSON:\n{text}\nReply with ONLY a valid JSON object, nothing else."
            )
        )
    )
    retry_text = _complete(model_instance, messages, model_parameters, stop, on_reasoning)
    parsed = _as_dict(retry_text)
    if parsed is not None:
        return parsed
    diagnostics.report("json_decode_failed", attempt=2)
    raise LlmError(f"model did not return valid JSON after one retry: {retry_text[:200]!r}")
