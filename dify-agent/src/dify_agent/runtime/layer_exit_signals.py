"""Validation and application of request-level Agenton layer exit signals.

HTTP requests carry data-only lifecycle intent in ``LayerExitSignals``. The
runtime validates the signal keys against the built compositor before a run is
persisted or entered, then applies the resolved intent after entry because
``Layer.lifecycle_enter`` resets controls to delete on each successful enter.
"""

from typing import Any

from agenton.compositor import Compositor, CompositorSession
from agenton.layers import ExitIntent
from dify_agent.protocol.schemas import LayerExitSignals


def validate_layer_exit_signals(
    compositor: Compositor[Any, Any, Any, Any, Any, Any],
    signals: LayerExitSignals,
) -> None:
    """Raise ``ValueError`` when ``signals`` mention layers absent from ``compositor``."""
    unknown_layer_ids = set(signals.layers) - set(compositor.layers)
    if not unknown_layer_ids:
        return

    names = ", ".join(sorted(unknown_layer_ids))
    raise ValueError(f"layer_exit_signals.layers references unknown layer ids: {names}.")


def apply_layer_exit_signals(session: CompositorSession, signals: LayerExitSignals) -> None:
    """Apply ``signals`` to active controls for the current compositor entry."""
    for layer_id, control in session.layer_controls.items():
        intent = signals.layers.get(layer_id, signals.default)
        if intent is ExitIntent.SUSPEND:
            control.suspend_on_exit()
        elif intent is ExitIntent.DELETE:
            control.delete_on_exit()
        else:
            raise ValueError(f"Unsupported layer exit intent: {intent!r}.")


__all__ = ["apply_layer_exit_signals", "validate_layer_exit_signals"]
