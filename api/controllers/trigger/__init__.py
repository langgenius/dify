from types import ModuleType

from flask import Blueprint

from controllers.trigger.errors import register_error_handlers

# Create trigger blueprint
bp = Blueprint("trigger", __name__, url_prefix="/triggers")
register_error_handlers(bp)


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
