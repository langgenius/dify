from flask import Blueprint

from controllers.trigger.errors import register_error_handlers

# Create trigger blueprint
bp = Blueprint("trigger", __name__, url_prefix="/triggers")
register_error_handlers(bp)

# Import routes after blueprint creation to avoid circular imports
from . import trigger, webhook

__all__ = [
    "trigger",
    "webhook",
]
