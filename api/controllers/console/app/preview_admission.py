"""Public catalog preview admission, separate from authenticated trial execution."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from controllers.console.app.error import AppNotFoundError
from extensions.ext_application_services import application_services
from services.app_preview_query_service import AppPreviewRef, AppPreviewUnavailableError


def get_preview_app[T, **P, R](
    view: Callable[Concatenate[T, AppPreviewRef, P], R],
) -> Callable[Concatenate[T, P], R]:
    @wraps(view)
    def decorated(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        app_id = kwargs.pop("app_id", None)
        if app_id is None:
            raise RuntimeError("The app preview admission route must provide app_id")
        try:
            app = application_services().app_previews.get_access(app_id=str(app_id))
        except AppPreviewUnavailableError as error:
            raise AppNotFoundError() from error
        return view(self, app, *args, **kwargs)

    return decorated
