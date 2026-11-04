from types import ModuleType

from flask import Blueprint

# Create trigger blueprint
bp = Blueprint("trigger", __name__, url_prefix="/triggers")


def _register_controllers() -> tuple[ModuleType, ...]:
    """Load route modules after their namespaces and schema models exist."""

    # Import routes after blueprint creation to avoid circular imports
    from . import trigger, webhook

    return (
        trigger,
        webhook,
    )


(
    trigger,
    webhook,
) = _register_controllers()

__all__ = [
    "trigger",
    "webhook",
]
