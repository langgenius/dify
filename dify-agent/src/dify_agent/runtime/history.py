"""Helpers for optional Dify Agent history-layer integration.

Dify Agent keeps pydantic-ai conversation history as an optional Agenton layer
named ``history``. Current system instructions belong to each run and are never
stored. Once Pydantic AI binds and builds messages in the run capture, its
complete captured history replaces the layer for every terminal outcome,
including interrupted runs. A failure or cancellation before the capture
contains messages preserves the previously restored history. When a run is
interrupted with tool calls the model returned but the run never executed, the
stored history records that the response was cut short so the next run can close
those calls out instead of refusing a new user prompt.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from typing import Protocol

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse

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


def replace_run_history(
    history_layer: PydanticAIHistoryLayer | None,
    messages: Sequence[ModelMessage],
    *,
    interrupted: bool = False,
) -> None:
    """Persist a run's captured history without transient instructions.

    Set ``interrupted`` when the run did not reach a terminal result, so tool calls the run
    never got to execute are marked as such for the next run.
    """
    if history_layer is None:
        return
    persistent_messages: list[ModelMessage] = [
        replace(message, instructions=None) if isinstance(message, ModelRequest) else message for message in messages
    ]
    if interrupted:
        persistent_messages = _mark_trailing_tool_calls_interrupted(persistent_messages)
    history_layer.replace_messages(persistent_messages)


def _mark_trailing_tool_calls_interrupted(messages: list[ModelMessage]) -> list[ModelMessage]:
    """Record that a final response's tool calls were never executed.

    A run cancelled between the model returning tool calls and the first tool result leaves a
    ``'complete'`` response whose calls have no matching result. Pydantic AI closes such calls
    out with synthesized returns on the next run only when that tail is marked
    ``'interrupted'``; otherwise it rejects the next user prompt and the conversation cannot
    continue. A run that ends in ``DeferredToolRequests`` keeps its open calls, which is why
    this is applied to interrupted runs only.
    """
    if not messages:
        return messages
    last_message = messages[-1]
    if not isinstance(last_message, ModelResponse) or last_message.state != "complete":
        return messages
    if not last_message.tool_calls:
        return messages
    return [*messages[:-1], replace(last_message, state="interrupted")]


__all__ = [
    "SupportsHistoryLayerLookup",
    "get_history_layer",
    "replace_run_history",
    "validate_history_layer_composition",
]
