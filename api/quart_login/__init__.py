"""
Quart-Login compatibility shim.

Quart does not ship an official login extension. This package re-exports
Flask-Login under the `quart_login` import path so the codebase can stay
on Quart while keeping Flask-Login's API surface.
"""

from flask_login import *  # noqa: F403
from flask_login import __all__  # noqa: F401
