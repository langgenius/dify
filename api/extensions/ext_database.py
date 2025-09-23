import logging

from sqlalchemy import event
from sqlalchemy.pool import Pool

from dify_app import DifyApp
from models.engine import db

logger = logging.getLogger(__name__)

# Global flag to avoid duplicate registration of event listener
_POOL_RESET_HANDLER_REGISTERED: bool = False


def _safe_rollback(connection):
    """Safely rollback database connection.

    Args:
        connection: Database connection object
    """
    try:
        connection.rollback()
    except Exception:  # pylint: disable=broad-exception-caught
        logger.exception("Failed to rollback connection")


def _setup_pool_reset_handler():
    global _POOL_RESET_HANDLER_REGISTERED  # pylint: disable=global-statement

    # Avoid duplicate registration
    if _POOL_RESET_HANDLER_REGISTERED:
        return

    @event.listens_for(Pool, "reset")
    def _safe_reset(dbapi_connection, connection_record, reset_state):  # pylint: disable=unused-argument
        if reset_state.terminate_only:
            return

        # Safe rollback for connection
        _safe_rollback(dbapi_connection)

    _POOL_RESET_HANDLER_REGISTERED = True


def init_app(app: DifyApp):
    db.init_app(app)
    _setup_pool_reset_handler()
