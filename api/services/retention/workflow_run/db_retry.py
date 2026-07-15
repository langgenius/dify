import logging
import time
from collections.abc import Callable

from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import OperationalError as SQLAlchemyOperationalError

DEFAULT_DB_RETRY_ATTEMPTS = 3
DEFAULT_DB_RETRY_DELAYS_SECONDS = (1.0, 2.0)

_DB_DISCONNECT_PATTERNS = (
    "server closed the connection unexpectedly",
    "connection already closed",
    "closed the connection",
    "connection not open",
    "terminating connection",
    "connection reset",
    "broken pipe",
    "connection invalidated",
)


def is_retryable_db_disconnect(exc: BaseException) -> bool:
    if isinstance(exc, DBAPIError) and exc.connection_invalidated:
        return True

    if not _is_db_operational_error(exc):
        return False

    original_exception = exc.orig if isinstance(exc, DBAPIError) else None
    message = f"{exc} {original_exception or ''}".lower()
    return any(pattern in message for pattern in _DB_DISCONNECT_PATTERNS)


def run_with_db_retry[T](
    operation_name: str,
    operation: Callable[[], T],
    *,
    logger: logging.Logger,
    attempts: int = DEFAULT_DB_RETRY_ATTEMPTS,
    delays_seconds: tuple[float, ...] = DEFAULT_DB_RETRY_DELAYS_SECONDS,
) -> T:
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as exc:
            if not is_retryable_db_disconnect(exc) or attempt == attempts:
                raise
            delay = delays_seconds[min(attempt - 1, len(delays_seconds) - 1)]
            logger.warning(
                "Retrying %s after retryable DB disconnect (attempt %s/%s, sleep %.1fs)",
                operation_name,
                attempt,
                attempts,
                delay,
                exc_info=True,
            )
            time.sleep(delay)
    raise RuntimeError(f"{operation_name} did not complete")


def _is_db_operational_error(exc: BaseException) -> bool:
    if isinstance(exc, SQLAlchemyOperationalError):
        return True

    return exc.__class__.__name__ == "OperationalError" and exc.__class__.__module__.startswith(("psycopg", "psycopg2"))
