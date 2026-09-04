"""Helpers for optional Dify Agent history-layer integration.

Dify Agent keeps pydantic-ai conversation history as an optional Agenton layer
named ``history``. Current system instructions belong to each run and are never
stored. Once Pydantic AI binds and builds messages in the run capture, its
complete captured history replaces the layer for every terminal outcome,
including interrupted runs. A failure or cancellation before the capture
contains messages preserves the previously restored history.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from typing import Protocol

from pydantic_ai.messages import ModelMessage, ModelRequest

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
) -> None:
    """Persist a run's captured history without transient instructions."""
    if history_layer is None:
        return
    persistent_messages = [
        replace(message, instructions=None) if isinstance(message, ModelRequest) else message for message in messages
    ]
    history_layer.replace_messages(persistent_messages)


__all__ = [
    "SupportsHistoryLayerLookup",
    "get_history_layer",
    "replace_run_history",
    "validate_history_layer_composition",
]
