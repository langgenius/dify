"""Controller session decorators.

`with_session` is an HTTP controller helper: it opens one SQLAlchemy session
for a Resource handler and injects it as the first argument after `self`.
Write handlers commit on success and roll back on failure. They use a regular
Session context so existing services may commit an intermediate unit and keep
using the same Session through SQLAlchemy's autobegin behavior. Pure read
handlers may opt out with `write=False`.
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
    """Inject a request-scoped session and finalize write handlers."""

    def decorator(view: Callable[Concatenate[T, Session, P], R]) -> Callable[Concatenate[T, P], R]:
        @wraps(view)
        def wrapper(self: T, *args: P.args, **kwargs: P.kwargs) -> R:
            if write:
                with session_factory.create_session() as session:
                    try:
                        result = view(self, session, *args, **kwargs)
                        session.commit()
                        return result
                    except Exception:
                        session.rollback()  # noqa: no-new-controller-sqlalchemy decorator owns transaction rollback
                        raise

            with session_factory.create_session() as session:
                return view(self, session, *args, **kwargs)

        return wrapper

    if view is None:
        return decorator
    return decorator(view)
