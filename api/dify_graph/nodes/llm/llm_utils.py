import json
import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.model_manager import ModelInstance
from dify_graph.file.models import File
from dify_graph.model_runtime.entities import PromptMessageRole
from dify_graph.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessage,
    TextPromptMessageContent,
)
from dify_graph.model_runtime.entities.model_entities import AIModelEntity
from dify_graph.model_runtime.memory import PromptMessageMemory
from dify_graph.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from dify_graph.runtime import VariablePool
from dify_graph.variables.segments import ArrayAnySegment, ArrayFileSegment, FileSegment, NoneSegment

from .exc import InvalidVariableTypeError

logger = logging.getLogger(__name__)

VARIABLE_PATTERN = re.compile(r"\{\{#[^#]+#\}\}")
MAX_RESOLVED_VALUE_LENGTH = 1024


def fetch_model_schema(*, model_instance: ModelInstance) -> AIModelEntity:
    model_schema = cast(LargeLanguageModel, model_instance.model_type_instance).get_model_schema(
        model_instance.model_name,
        model_instance.credentials,
    )
    if not model_schema:
        raise ValueError(f"Model schema not found for {model_instance.model_name}")
    return model_schema


def fetch_files(variable_pool: VariablePool, selector: Sequence[str]) -> Sequence["File"]:
    variable = variable_pool.get(selector)
    if variable is None:
        return []
    elif isinstance(variable, FileSegment):
        return [variable.value]
    elif isinstance(variable, ArrayFileSegment):
        return variable.value
    elif isinstance(variable, NoneSegment | ArrayAnySegment):
        return []
    raise InvalidVariableTypeError(f"Invalid variable type: {type(variable)}")


def convert_history_messages_to_text(
    *,
    history_messages: Sequence[PromptMessage],
    human_prefix: str,
    ai_prefix: str,
) -> str:
    string_messages: list[str] = []
    for message in history_messages:
        if message.role == PromptMessageRole.USER:
            role = human_prefix
        elif message.role == PromptMessageRole.ASSISTANT:
            role = ai_prefix
        else:
            continue

        if isinstance(message.content, list):
            content_parts = []
            for content in message.content:
                if isinstance(content, TextPromptMessageContent):
                    content_parts.append(content.data)
                elif isinstance(content, ImagePromptMessageContent):
                    content_parts.append("[image]")

            inner_msg = "\n".join(content_parts)
            string_messages.append(f"{role}: {inner_msg}")
        else:
            string_messages.append(f"{role}: {message.content}")

    return "\n".join(string_messages)


def fetch_memory_text(
    *,
    memory: PromptMessageMemory,
    max_token_limit: int,
    message_limit: int | None = None,
    human_prefix: str = "Human",
    ai_prefix: str = "Assistant",
) -> str:
    history_messages = memory.get_history_prompt_messages(
        max_token_limit=max_token_limit,
        message_limit=message_limit,
    )
    return convert_history_messages_to_text(
        history_messages=history_messages,
        human_prefix=human_prefix,
        ai_prefix=ai_prefix,
    )


def _coerce_resolved_value(raw: str) -> int | float | bool | str:
    """Try to restore the original type from a resolved template string.

    Variable references are always resolved to text, but completion params may
    expect numeric or boolean values (e.g. a variable that holds "0.7" mapped to
    the ``temperature`` parameter).  This helper attempts a JSON parse so that
    ``"0.7"`` → ``0.7``, ``"true"`` → ``True``, etc.  Plain strings that are not
    valid JSON literals are returned as-is.
    """
    stripped = raw.strip()
    if not stripped:
        return raw

    try:
        parsed: object = json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        return raw

    if isinstance(parsed, (int, float, bool)):
        return parsed
    return raw


def resolve_completion_params_variables(
    completion_params: Mapping[str, Any],
    variable_pool: VariablePool,
) -> dict[str, Any]:
    """Resolve variable references (``{{#node_id.var#}}``) in string-typed completion params.

    Security notes:
    - Resolved values are length-capped to ``MAX_RESOLVED_VALUE_LENGTH`` to
      prevent denial-of-service through excessively large variable payloads.
    - This follows the same ``VariablePool.convert_template`` pattern used across
      Dify (Answer Node, HTTP Request Node, Agent Node, etc.).  The downstream
      model plugin receives these values as structured JSON key-value pairs — they
      are never concatenated into raw HTTP headers or SQL queries.
    - Numeric/boolean coercion is applied so that variables holding ``"0.7"`` are
      restored to their native type rather than sent as a bare string.
    """
    resolved: dict[str, Any] = {}
    for key, value in completion_params.items():
        if isinstance(value, str) and VARIABLE_PATTERN.search(value):
            segment_group = variable_pool.convert_template(value)
            text = segment_group.text
            if len(text) > MAX_RESOLVED_VALUE_LENGTH:
                logger.warning(
                    "Resolved value for param '%s' truncated from %d to %d chars",
                    key,
                    len(text),
                    MAX_RESOLVED_VALUE_LENGTH,
                )
                text = text[:MAX_RESOLVED_VALUE_LENGTH]
            resolved[key] = _coerce_resolved_value(text)
        else:
            resolved[key] = value
    return resolved
