"""Non-streaming LLM helper for the Dify Builder agent.

Blocking calls are fine — advances run in a Celery worker. invoke_json mirrors
the repo's hardened WorkflowGenerator._invoke_and_parse_json: parse with
json_repair, and on failure retry ONCE with a corrective hint before raising.
"""

from typing import Any

import json_repair

from graphon.model_runtime.entities.message_entities import SystemPromptMessage, UserPromptMessage


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


def invoke_text(model_instance, *, system: str, user: str, model_parameters: dict[str, Any] | None = None,
                stop: list[str] | None = None) -> str:
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    return _complete(model_instance, messages, model_parameters, stop)


def invoke_json(model_instance, *, system: str, user: str, model_parameters: dict[str, Any] | None = None,
                stop: list[str] | None = None) -> dict[str, Any]:
    messages = [SystemPromptMessage(content=system), UserPromptMessage(content=user)]
    text = _complete(model_instance, messages, model_parameters, stop)
    parsed = _as_dict(text)
    if parsed is not None:
        return parsed
    messages.append(UserPromptMessage(
        content=f"Your previous reply was not valid JSON:\n{text}\nReply with ONLY a valid JSON object, nothing else."
    ))
    retry_text = _complete(model_instance, messages, model_parameters, stop)
    parsed = _as_dict(retry_text)
    if parsed is not None:
        return parsed
    raise LlmError(f"model did not return valid JSON after one retry: {retry_text[:200]!r}")
