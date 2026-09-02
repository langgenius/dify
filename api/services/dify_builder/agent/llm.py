"""LLM helpers for the Dify Builder agent.

Blocking calls are fine — advances run in a Celery worker. Chat replies expose
the model's native stream while structured cognition remains blocking.
``invoke_json`` mirrors the repo's hardened
WorkflowGenerator._invoke_and_parse_json: parse with json_repair, and on
failure retry ONCE with a corrective hint before raising.
"""

from collections.abc import Generator, Iterator
from typing import Any, cast

import json_repair

from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk
from graphon.model_runtime.entities.message_entities import (
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)


class LlmError(Exception):
    """The model did not return usable output (e.g. non-JSON after one retry)."""


def _complete(model_instance, messages, model_parameters, stop) -> str:
    result = model_instance.invoke_llm(
        prompt_messages=messages, model_parameters=model_parameters or {}, stop=stop, stream=False
    )
    return result.message.get_text_content()


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
) -> str:
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    return _complete(model_instance, messages, model_parameters, stop)


def invoke_text_stream(
    model_instance,
    *,
    system: str,
    user: str,
    model_parameters: dict[str, Any] | None = None,
    stop: list[str] | None = None,
) -> Iterator[str]:
    """Yield assistant text deltas from the model's native streaming API."""
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    result = model_instance.invoke_llm(
        prompt_messages=messages,
        model_parameters=model_parameters or {},
        stop=stop,
        stream=True,
    )
    if isinstance(result, LLMResult):
        text = result.message.get_text_content()
        if text:
            yield text
        return

    for chunk in cast(Generator[LLMResultChunk, None, None], result):
        content = chunk.delta.message.content
        if isinstance(content, str):
            if content:
                yield content
            continue
        if not isinstance(content, list):
            continue

        delta = ""
        for part in cast(list[object], content):
            if isinstance(part, TextPromptMessageContent):
                delta += part.data
            elif isinstance(part, str):
                delta += part
        if delta:
            yield delta


def invoke_json(
    model_instance,
    *,
    system: str,
    user: str,
    model_parameters: dict[str, Any] | None = None,
    stop: list[str] | None = None,
) -> dict[str, Any]:
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    text = _complete(model_instance, messages, model_parameters, stop)
    parsed = _as_dict(text)
    if parsed is not None:
        return parsed
    messages.append(
        UserPromptMessage(
            content=(
                f"Your previous reply was not valid JSON:\n{text}\nReply with ONLY a valid JSON object, nothing else."
            )
        )
    )
    retry_text = _complete(model_instance, messages, model_parameters, stop)
    parsed = _as_dict(retry_text)
    if parsed is not None:
        return parsed
    raise LlmError(f"model did not return valid JSON after one retry: {retry_text[:200]!r}")
