"""
Core Dependency Injection Container.
Combines a lightweight Flask `g`-based container mechanism with
dependency_injector to manage core scoped resources like db.session.
"""

from dependency_injector import containers, providers
from flask import g, has_app_context

from extensions.ext_database import db


def _get_flask_session():
    """
    Returns the Flask-SQLAlchemy request-scoped session.
    If outside a request context, returns the global session (mostly for testing).
    """
    if has_app_context() and hasattr(g, "db_session"):
        return g.db_session

    # Fallback to standard scoped session proxy
    return db.session


class CoreContainer(containers.DeclarativeContainer):
    """
    Dependency Injector container for the Dify core.
    """

    db_session = providers.Callable(_get_flask_session)
