"""
Quart-RESTX compatibility shim.

Re-export Flask-RESTX under the `quart_restx` import path so existing code can
stay compatible with Quart while keeping Flask-RESTX's API surface.
"""

from flask_restx import *  # noqa: F403
from flask_restx import __all__  # noqa: F401
