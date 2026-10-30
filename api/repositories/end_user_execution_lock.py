"""Short, transaction-owned identity locks for Web identity updates and migration."""

from collections.abc import Generator
from contextlib import contextmanager

from psycopg2.errors import LockNotAvailable
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from models.model import EndUser
from repositories.entities.web_execution import EndUserBusyError


@contextmanager
def translate_end_user_lock_errors() -> Generator[None]:
    try:
        yield
    except OperationalError as error:
        original = error.orig
        args = original.args if isinstance(original, BaseException) else ()
        if isinstance(original, LockNotAvailable) or (isinstance(args, tuple) and args and args[0] == 3572):
            raise EndUserBusyError() from error
        raise


@translate_end_user_lock_errors()
def lock_end_user(
    session: Session, *, tenant_id: str, app_id: str, end_user_id: str, exclusive: bool
) -> EndUser | None:
    """Lock one identity without queuing behind another identity update."""
    return session.scalar(
        select(EndUser)
        .where(EndUser.id == end_user_id, EndUser.tenant_id == tenant_id, EndUser.app_id == app_id)
        .with_for_update(read=not exclusive, nowait=True)
        .execution_options(populate_existing=True)
    )
