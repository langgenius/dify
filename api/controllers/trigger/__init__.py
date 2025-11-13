from flask import Blueprint

# Create trigger blueprint
bp = Blueprint("trigger", __name__, url_prefix="/triggers")

# Import routes after blueprint creation to avoid circular imports
from . import trigger, webhook

__all__ = [
    "trigger",
    "webhook",
]
