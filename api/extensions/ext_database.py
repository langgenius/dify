import logging
from typing import Any

import gevent
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import Pool

from dify_app import DifyApp
from models.engine import db

logger = logging.getLogger(__name__)

# Global flag to avoid duplicate registration of event listener
_gevent_compatibility_setup: bool = False


def _safe_rollback(connection: Any) -> None:
    """Safely rollback database connection.

    Args:
        connection: Database connection object
    """
    try:
        connection.rollback()
    except Exception:  # pylint: disable=broad-exception-caught
        logger.exception("Failed to rollback connection")


def _setup_gevent_compatibility():
    global _gevent_compatibility_setup  # pylint: disable=global-statement

    # Avoid duplicate registration
    if _gevent_compatibility_setup:
        return

    @event.listens_for(Pool, "reset")
    def _safe_reset(dbapi_connection: Any, connection_record: Any, reset_state: Any) -> None:  # pyright: ignore[reportUnusedFunction]
        if reset_state.terminate_only:
            return

        # Safe rollback for connection
        try:
            hub = gevent.get_hub()
            if hasattr(hub, "loop") and getattr(hub.loop, "in_callback", False):
                gevent.spawn_later(0, lambda: _safe_rollback(dbapi_connection))
            else:
                _safe_rollback(dbapi_connection)
        except (AttributeError, ImportError):
            _safe_rollback(dbapi_connection)

    _gevent_compatibility_setup = True


_session_maker: sessionmaker[Session] | None = None


def get_session_maker() -> sessionmaker[Session]:
    global _session_maker
    if _session_maker is None:
        _session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    return _session_maker


def init_app(app: DifyApp) -> None:
    db.init_app(app)
    global _session_maker
    # Ensure we access db.engine within an application context
    with app.app_context():
        _session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    _setup_gevent_compatibility()
