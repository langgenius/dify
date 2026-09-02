import logging

import gevent
from sqlalchemy import event
from sqlalchemy.pool import Pool

from configs import dify_config
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


def init_app(app: DifyApp):
    db.init_app(app)
    _setup_gevent_compatibility()

    # Eagerly build the engine so pool_size/max_overflow/etc. come from config
    try:
        with app.app_context():
            _ = db.engine  # triggers engine creation with the configured options
    except Exception:
        logger.exception("Failed to initialize SQLAlchemy engine during app startup")

    # Mirror ext_logging._apply_timezone on the SQLAlchemy logger hierarchy
    # so engine/pool/dialect log timestamps honor dify_config.LOG_TZ.
    _apply_timezone_to_sqlalchemy_loggers()


def _apply_timezone_to_sqlalchemy_loggers() -> None:
    """Apply LOG_TZ to every handler on the ``sqlalchemy`` logger tree.

    SQLAlchemy attaches its own ``StreamHandler`` to ``sqlalchemy.engine``
    (and descendants like ``sqlalchemy.pool`` / ``sqlalchemy.engine.Engine``)
    when ``echo=True`` is enabled. Those handlers use a default
    ``logging.Formatter`` whose ``converter`` is ``time.localtime``, which
    ignores ``dify_config.LOG_TZ`` and yields timestamps that disagree
    with the rest of the application log stream.

    This helper walks the SQLAlchemy logger hierarchy and rewrites the
    ``converter`` on every handler's formatter, mirroring the pattern in
    ``ext_logging._apply_timezone``.

    A no-op when ``LOG_TZ`` is unset or when SQLAlchemy has not yet
    attached any handlers (e.g. ``echo`` is not enabled). The eager
    engine build in ``init_app`` makes the common case (engine logger
    with a handler) visible to this helper; handlers attached later
    (e.g. when ``echo`` is toggled at runtime) will need another call.
    """
    log_tz = dify_config.LOG_TZ
    if not log_tz:
        return

    from datetime import datetime

    import pytz

    timezone = pytz.timezone(log_tz)

    def time_converter(seconds: float):
        return datetime.fromtimestamp(seconds, tz=timezone).timetuple()

    sqla_logger = logging.getLogger("sqlalchemy")
    for descendant in _iter_logger_descendants(sqla_logger):
        for handler in descendant.handlers:
            formatter = handler.formatter
            if formatter is not None and hasattr(formatter, "converter"):
                formatter.converter = time_converter  # type: ignore[attr-defined]


def _iter_logger_descendants(root: logging.Logger):
    """Yield ``root`` and every ``logging.Logger`` whose name starts with ``root.name + '.'``."""
    prefix = root.name + "."
    yield root
    for name, child in list(root.manager.loggerDict.items()):
        if isinstance(child, logging.Logger) and name.startswith(prefix):
            yield child
