"""Count and page through log export rows with bounded database waits."""

import logging
from collections.abc import Callable
from enum import StrEnum
from random import uniform
from time import sleep

from psycopg2 import Error as PostgreSQLDriverError
from psycopg2 import OperationalError as PostgreSQLDriverOperationalError
from psycopg2 import extensions as pg_extensions
from psycopg2.errors import QueryCanceled
from sqlalchemy import Select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

_LOG_EXPORT_COUNT_TIMEOUT_MS = 1500
_LOG_EXPORT_RECOVERY_RETRY_DELAYS = (1.0, 2.0, 4.0)
_LOG_EXPORT_RECOVERY_CONFLICT_MESSAGES = (
    "canceling statement due to conflict with recovery",
    "terminating connection due to conflict with recovery",
)
logger = logging.getLogger(__name__)


def execute_log_export_count[CountT: tuple[object, ...]](session: Session, statement: Select[CountT]) -> CountT | None:
    """Execute a one-row count in a dedicated read session and return None on statement timeout.

    The caller closes the session on all paths. The PostgreSQL timeout is local
    to that transaction. Databases other than PostgreSQL and MySQL use their own defaults.
    """
    dialect = session.get_bind().dialect.name
    try:
        if dialect == "postgresql":
            session.execute(text(f"SET LOCAL statement_timeout = {_LOG_EXPORT_COUNT_TIMEOUT_MS}"))
        elif dialect == "mysql":
            statement = statement.prefix_with(f"/*+ MAX_EXECUTION_TIME({_LOG_EXPORT_COUNT_TIMEOUT_MS}) */")
        return session.execute(statement).tuples().one()
    except DBAPIError as exc:
        if isinstance(exc.orig, QueryCanceled) or (
            dialect == "mysql" and exc.orig is not None and exc.orig.args and exc.orig.args[0] == 3024
        ):
            return None
        raise


class _LogExportPageRetryReason(StrEnum):
    RECOVERY_CONFLICT = "recovery conflict"
    STANDBY_DISCONNECT = "standby disconnect"


def _log_export_requires_standby(session: Session) -> bool:
    """Inspect the live driver's effective connection policy before the page executes."""
    connection = session.connection()
    driver = connection.connection.driver_connection
    if not isinstance(driver, pg_extensions.connection):
        return False
    key = "log_export_requires_standby"
    # Connection.info lives with the pooled connection, and libpq resolves the DSN and environment.
    if key not in connection.info:
        connection.info[key] = driver.get_dsn_parameters().get("target_session_attrs") == "standby"
    return connection.info[key] is True and driver.get_parameter_status("in_hot_standby") != "off"


def _log_export_retry_reason(error: DBAPIError, *, requires_standby: bool) -> _LogExportPageRetryReason | None:
    """Recognize explicit recovery conflicts or confirmed disconnects on standby-only connections."""
    cause = error.orig
    if not isinstance(cause, PostgreSQLDriverError) or cause.pgcode not in (None, "40001"):
        return None
    message = (cause.diag.message_primary or str(cause).partition("\n")[0]).lower()
    if any(marker in message for marker in _LOG_EXPORT_RECOVERY_CONFLICT_MESSAGES):
        return _LogExportPageRetryReason.RECOVERY_CONFLICT
    if (
        requires_standby
        and error.connection_invalidated
        and isinstance(cause, PostgreSQLDriverOperationalError)
        and cause.pgcode is None
    ):
        return _LogExportPageRetryReason.STANDBY_DISCONNECT
    return None


def read_log_export_with_retry[PageT](
    session_factory: sessionmaker[Session],
    target_id: str,
    page_type: str,
    read: Callable[[Session], PageT],
    *,
    export_kind: str,
) -> PageT:
    """Read a complete export batch or a staged selection with the caller's fixed scope.

    The callback must restart any partial staging on retry and publish no output.
    Each attempt closes its session before returning or retrying. Raise the last error if the read fails.
    """
    retry_delays = _LOG_EXPORT_RECOVERY_RETRY_DELAYS
    for attempt, delay in enumerate((*retry_delays, None), start=1):
        requires_standby = False
        try:
            with session_factory() as session:
                requires_standby = _log_export_requires_standby(session)
                try:
                    return read(session)
                except DBAPIError as error:
                    if _log_export_retry_reason(error, requires_standby=requires_standby) is not None:
                        try:
                            session.invalidate()
                        except DBAPIError:
                            logger.warning("Failed to discard a %s log export page connection", export_kind)
                    raise
        except DBAPIError as error:
            reason = _log_export_retry_reason(error, requires_standby=requires_standby)
            sqlstate = error.orig.pgcode if isinstance(error.orig, PostgreSQLDriverError) else None
            target = "agent" if export_kind == "agent" else "app"
            if reason is None or delay is None:
                logger.warning(
                    "%s log export page failed: %s=%s page=%s attempt=%s/%s "
                    "reason=%s error=%s sqlstate=%s connection_invalidated=%s",
                    export_kind.capitalize(),
                    target,
                    target_id,
                    page_type,
                    attempt,
                    len(retry_delays) + 1,
                    reason or "not retryable",
                    type(error.orig).__name__,
                    sqlstate,
                    error.connection_invalidated,
                )
                raise
            logger.warning(
                "Retrying %s log export page after PostgreSQL %s: "
                "%s=%s page=%s retry=%s/%s sqlstate=%s connection_invalidated=%s",
                export_kind,
                reason,
                target,
                target_id,
                page_type,
                attempt,
                len(retry_delays),
                sqlstate,
                error.connection_invalidated,
            )
            sleep(delay + uniform(0, 0.25))  # noqa: S311
    raise AssertionError("Log export page retry loop exhausted without returning or raising")
