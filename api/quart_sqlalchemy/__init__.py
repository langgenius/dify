"""
Quart-SQLAlchemy compatibility shim.

Re-export Flask-SQLAlchemy under the `quart_sqlalchemy` import path so existing
code can keep the Quart import surface.
"""

from flask_sqlalchemy import *  # noqa: F403
from flask_sqlalchemy import __all__
