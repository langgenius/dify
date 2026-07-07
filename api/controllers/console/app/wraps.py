"""Controller decorators for console app resources.

App-loading decorators prefer a session injected by
`controllers.common.session.with_session` when present, while still supporting
existing handlers that have not been migrated yet and still rely on
Flask-SQLAlchemy's scoped `db.session`.
"""

from collections.abc import Callable
from functools import wraps
from typing import cast, overload

from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.common.session import with_session
from controllers.console.app.error import AppNotFoundError
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models import App, AppMode

__all__ = ["get_app_model", "get_app_model_with_trial", "with_session"]


def _load_app_model(session: Session, app_id: str) -> App | None:
    """Load the tenant-scoped app row with the request session owned by `with_session`."""
    _, current_tenant_id = current_account_with_tenant()
    app_model = session.scalar(
        select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
    )
    return app_model


def _load_app_model_from_scoped_session(app_id: str) -> App | None:
    """Load the app row for legacy handlers that have not adopted request session injection yet."""
    _, current_tenant_id = current_account_with_tenant()
    app_model = db.session.scalar(
        select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
    )
    return app_model


def _load_app_model_with_trial(app_id: str) -> App | None:
    app_model = db.session.scalar(select(App).where(App.id == app_id, App.status == "normal").limit(1))
    return app_model


def _get_injected_session(args: tuple[object, ...]) -> Session | None:
    """Return the request session inserted by `with_session`, if this handler has been migrated."""
    if len(args) < 2:
        return None

    candidate = args[1]
    if isinstance(candidate, Session):
        return candidate

    if hasattr(candidate, "scalar") and hasattr(candidate, "commit") and hasattr(candidate, "rollback"):
        return cast(Session, candidate)

    return None


@overload
def get_app_model[**P, R](
    view: Callable[P, R],
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R]: ...


@overload
def get_app_model[**P, R](
    view: None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def get_app_model[**P, R](
    view: Callable[P, R] | None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Inject the App model for handlers that receive an `app_id` path parameter.

    New handlers may compose `@with_session` above this decorator so the app row
    is loaded through the same request-scoped session used by the controller.
    Existing handlers continue to work through `db.session` until migrated.
    """

    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
            if not kwargs.get("app_id"):
                raise ValueError("missing app_id in path parameters")

            app_id = kwargs.get("app_id")
            app_id = str(app_id)

            del kwargs["app_id"]

            session = _get_injected_session(args)
            if session is None:
                app_model = _load_app_model_from_scoped_session(app_id)
            else:
                app_model = _load_app_model(session, app_id)

            if not app_model:
                raise AppNotFoundError()

            app_mode = AppMode.value_of(app_model.mode)

            if mode is not None:
                if isinstance(mode, list):
                    modes = mode
                else:
                    modes = [mode]

                if app_mode not in modes:
                    mode_values = {m.value for m in modes}
                    raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")

            kwargs["app_model"] = app_model

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


@overload
def get_app_model_with_trial[**P, R](
    view: Callable[P, R],
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R]: ...


@overload
def get_app_model_with_trial[**P, R](
    view: None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def get_app_model_with_trial[**P, R](
    view: Callable[P, R] | None = None,
    *,
    mode: AppMode | list[AppMode] | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
            if not kwargs.get("app_id"):
                raise ValueError("missing app_id in path parameters")

            app_id = kwargs.get("app_id")
            app_id = str(app_id)

            del kwargs["app_id"]

            app_model = _load_app_model_with_trial(app_id)

            if not app_model:
                raise AppNotFoundError()

            app_mode = AppMode.value_of(app_model.mode)

            if mode is not None:
                if isinstance(mode, list):
                    modes = mode
                else:
                    modes = [mode]

                if app_mode not in modes:
                    mode_values = {m.value for m in modes}
                    raise AppNotFoundError(f"App mode is not in the supported list: {mode_values}")

            kwargs["app_model"] = app_model

            return view_func(*args, **kwargs)

        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)
