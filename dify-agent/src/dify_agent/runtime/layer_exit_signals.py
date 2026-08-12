"""Validation and application of request-level Agenton layer exit signals.

HTTP requests carry data-only lifecycle intent in the top-level ``on_exit``
field. The runtime validates signal keys against the built compositor before a
run is persisted or entered, then applies the resolved intent to the active
``CompositorRun`` after entry because Agenton initializes each run slot with a
delete-on-exit intent.
"""

from typing import Any

from agenton.compositor import Compositor, CompositorRun
from agenton.layers import ExitIntent
from dify_agent.protocol.schemas import LayerExitSignals


def validate_layer_exit_signals(
    compositor: Compositor[Any, Any, Any, Any, Any, Any],
    signals: LayerExitSignals,
) -> None:
    """Raise ``ValueError`` when ``signals`` mention layers absent from ``compositor``."""
    known_layer_ids = {node.name for node in compositor.nodes}
    unknown_layer_ids = set(signals.layers) - known_layer_ids
    if not unknown_layer_ids:
        return

    names = ", ".join(sorted(unknown_layer_ids))
    raise ValueError(f"on_exit.layers references unknown layer ids: {names}.")


def apply_layer_exit_signals(
    run: CompositorRun[Any, Any, Any, Any, Any, Any],
    signals: LayerExitSignals,
) -> None:
    """Apply ``signals`` to active run slots for the current compositor entry."""
    for layer_id in run.slots:
        intent = signals.layers.get(layer_id, signals.default)
        if intent is ExitIntent.SUSPEND:
            run.suspend_layer_on_exit(layer_id)
        elif intent is ExitIntent.DELETE:
            run.delete_layer_on_exit(layer_id)
        else:
            raise ValueError(f"Unsupported layer exit intent: {intent!r}.")


__all__ = ["apply_layer_exit_signals", "validate_layer_exit_signals"]
