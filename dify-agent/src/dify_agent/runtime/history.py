"""Helpers for optional Dify Agent history-layer integration.

Dify Agent keeps pydantic-ai conversation history as an optional Agenton layer
named ``history``. The runner always injects the current Dify system prompt via
temporary ``message_history`` instead of ``Agent.system_prompt(...)`` so the
model sees ``current system prompt -> stored history -> current user prompt``
even when persisted history is present. Only zero-argument system prompt
callables are supported here because the prompts are rendered outside
pydantic-ai's normal run context; this matches Dify's current plain-prompt
compositions and fails fast for unsupported context-dependent prompt shapes.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol, cast

from pydantic_ai.messages import ModelMessage, ModelRequest, SystemPromptPart

from agenton.layers.types import PydanticAIPrompt
from agenton_collections.layers.pydantic_ai import PYDANTIC_AI_HISTORY_LAYER_TYPE_ID, PydanticAIHistoryLayer
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID
from dify_agent.protocol.schemas import RunComposition


class SupportsHistoryLayerLookup(Protocol):
    """Minimal entered-run surface needed by the history helper."""

    def get_layer(self, name: str, layer_type: type[PydanticAIHistoryLayer]) -> PydanticAIHistoryLayer:
        """Return a typed layer instance or raise lookup/type errors."""
        ...


def validate_history_layer_composition(composition: RunComposition) -> None:
    """Reject unsupported public history-layer graph shapes."""
    history_layers = [layer for layer in composition.layers if layer.type == PYDANTIC_AI_HISTORY_LAYER_TYPE_ID]
    if not history_layers:
        return

    if len(history_layers) > 1:
        names = ", ".join(layer.name for layer in history_layers)
        raise ValueError(
            f"Only one '{PYDANTIC_AI_HISTORY_LAYER_TYPE_ID}' layer is supported, named "
            f"'{DIFY_AGENT_HISTORY_LAYER_ID}'. Found layers: {names}."
        )

    history_layer = history_layers[0]
    if history_layer.name != DIFY_AGENT_HISTORY_LAYER_ID:
        raise ValueError(
            f"Layer type '{PYDANTIC_AI_HISTORY_LAYER_TYPE_ID}' must use reserved layer name "
            f"'{DIFY_AGENT_HISTORY_LAYER_ID}', got '{history_layer.name}'."
        )

    if history_layer.deps:
        dependency_names = ", ".join(sorted(history_layer.deps))
        raise ValueError(
            f"Layer type '{PYDANTIC_AI_HISTORY_LAYER_TYPE_ID}' does not support dependencies; "
            f"got dependency keys: {dependency_names}."
        )


def get_history_layer(run: SupportsHistoryLayerLookup) -> PydanticAIHistoryLayer | None:
    """Return the active history layer when the reserved slot is present."""
    try:
        return run.get_layer(DIFY_AGENT_HISTORY_LAYER_ID, PydanticAIHistoryLayer)
    except KeyError:
        return None


async def build_run_message_history(
    *,
    system_prompts: Sequence[PydanticAIPrompt[object]],
    stored_history: Sequence[ModelMessage],
) -> list[ModelMessage] | None:
    """Build temporary pydantic-ai history for one Dify Agent loop.

    Current system prompts are rendered first into one transient
    ``ModelRequest`` prefix, followed by any already stored history messages.
    When both inputs are empty, the helper returns ``None`` so callers can omit
    the ``message_history`` argument entirely and preserve pydantic-ai's empty
    history behavior.
    """
    rendered_system_parts: list[SystemPromptPart] = []
    for prompt in system_prompts:
        prompt_text = await _render_system_prompt(prompt)
        if prompt_text is None:
            continue
        rendered_system_parts.append(SystemPromptPart(content=prompt_text))

    message_history: list[ModelMessage] = []
    if rendered_system_parts:
        message_history.append(ModelRequest(parts=rendered_system_parts))
    message_history.extend(stored_history)
    return message_history or None


def append_successful_run_history(
    history_layer: PydanticAIHistoryLayer | None,
    new_messages: Sequence[ModelMessage],
) -> None:
    """Append only newly produced pydantic-ai messages after successful runs."""
    if history_layer is None or not new_messages:
        return
    history_layer.append_messages(new_messages)


async def _render_system_prompt(prompt: PydanticAIPrompt[object]) -> str | None:
    signature = inspect.signature(prompt)
    if signature.parameters:
        raise ValueError(
            "Dify Agent runtime currently supports only zero-argument system prompts when rendering temporary "
            "message history."
        )

    prompt_without_context = cast(Callable[[], str | None | Awaitable[str | None]], prompt)
    prompt_value = prompt_without_context()
    if inspect.isawaitable(prompt_value):
        prompt_value = await prompt_value
    if prompt_value is None:
        return None
    if not isinstance(prompt_value, str):
        raise TypeError(f"System prompt callables must return str | None, got '{type(prompt_value).__name__}'.")
    return prompt_value


__all__ = [
    "SupportsHistoryLayerLookup",
    "append_successful_run_history",
    "build_run_message_history",
    "get_history_layer",
    "validate_history_layer_composition",
]
