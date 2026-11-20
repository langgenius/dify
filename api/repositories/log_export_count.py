"""Run Console log export previews with a bounded database wait."""

from psycopg2.errors import QueryCanceled
from sqlalchemy import Select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

_LOG_EXPORT_COUNT_TIMEOUT_MS = 1500


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
