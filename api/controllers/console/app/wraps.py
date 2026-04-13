from collections.abc import Callable
from functools import wraps
from typing import overload

from sqlalchemy import select

from controllers.console.app.error import AppNotFoundError
from extensions.ext_database import db
from libs.login import current_account_with_tenant
from models import App, AppMode


def _load_app_model(app_id: str) -> App | None:
    _, current_tenant_id = current_account_with_tenant()
    app_model = db.session.scalar(
        select(App).where(App.id == app_id, App.tenant_id == current_tenant_id, App.status == "normal").limit(1)
    )
    return app_model


def _load_app_model_with_trial(app_id: str) -> App | None:
    app_model = db.session.scalar(select(App).where(App.id == app_id, App.status == "normal").limit(1))
    return app_model


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
    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
            if not kwargs.get("app_id"):
                raise ValueError("missing app_id in path parameters")

            app_id = kwargs.get("app_id")
            app_id = str(app_id)

            del kwargs["app_id"]

            app_model = _load_app_model(app_id)

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
