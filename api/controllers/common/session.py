"""Controller session decorators.

`with_session` is an HTTP controller helper: it opens one SQLAlchemy session
for a Resource handler and injects it as the first argument after `self`.
Handlers use a transaction by default so migrated write paths keep
commit/rollback handling; pure read handlers opt into a guarded read-only
session with `write=False`.
"""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate, overload

from sqlalchemy.orm import Session

from core.db.session_factory import session_factory


@overload
def with_session[T, **P, R](
    view: Callable[Concatenate[T, Session, P], R],
    *,
    write: bool = True,
) -> Callable[Concatenate[T, P], R]: ...


@overload
def with_session[T, **P, R](
    view: None = None,
    *,
    write: bool = True,
) -> Callable[[Callable[Concatenate[T, Session, P], R]], Callable[Concatenate[T, P], R]]: ...


def with_session[T, **P, R](
    view: Callable[Concatenate[T, Session, P], R] | None = None,
    *,
    write: bool = True,
) -> (
    Callable[Concatenate[T, P], R] | Callable[[Callable[Concatenate[T, Session, P], R]], Callable[Concatenate[T, P], R]]
):
    """Inject a request-scoped session, using a transaction only for write handlers."""

    def decorator(view: Callable[Concatenate[T, Session, P], R]) -> Callable[Concatenate[T, P], R]:
        @wraps(view)
        def wrapper(self: T, *args: P.args, **kwargs: P.kwargs) -> R:
            if write:
                with session_factory.get_session_maker().begin() as session:
                    return view(self, session, *args, **kwargs)

            with session_factory.create_readonly_session() as session:
                return view(self, session, *args, **kwargs)

        return wrapper

    if view is None:
        return decorator
    return decorator(view)
