import logging

import gevent
from sqlalchemy import Engine, event
from sqlalchemy.pool import Pool

from configs import dify_config
from core.db.connection_hold_monitor import ConnectionHoldMonitor
from dify_app import DifyApp
from models.engine import db

logger = logging.getLogger(__name__)

# Global flag to avoid duplicate registration of event listener
_gevent_compatibility_setup: bool = False


def _safe_rollback(connection):
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
    def _safe_reset(dbapi_connection, connection_record, reset_state):
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


def install_connection_hold_monitor(engine: Engine) -> ConnectionHoldMonitor | None:
    """Watch ``engine``'s pool for held connections when SQLALCHEMY_POOL_HOLD_WARNING_SECONDS is set."""
    warn_after_seconds = dify_config.SQLALCHEMY_POOL_HOLD_WARNING_SECONDS
    if warn_after_seconds <= 0:
        return None
    # A pool size of 0 means "no limit" to SQLAlchemy, so there is no point at which the pool is full.
    capacity = (
        dify_config.SQLALCHEMY_POOL_SIZE + dify_config.SQLALCHEMY_MAX_OVERFLOW
        if dify_config.SQLALCHEMY_POOL_SIZE > 0
        else None
    )
    monitor = ConnectionHoldMonitor(warn_after_seconds=warn_after_seconds, capacity=capacity)
    monitor.install(engine.pool)
    return monitor


def init_app(app: DifyApp):
    db.init_app(app)
    _setup_gevent_compatibility()

    try:
        with app.app_context():
            # Reading db.engine builds it, so pool_size/max_overflow/etc. come from config.
            monitor = install_connection_hold_monitor(db.engine)
            if monitor is not None:
                app.extensions["connection_hold_monitor"] = monitor
    except Exception:
        logger.exception("Failed to initialize SQLAlchemy engine during app startup")
