"""Installed-app admission for handlers using a pure installation reference."""

import logging
from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from controllers.console.explore.error import (
    AppAccessDeniedError,
    InstalledAppNotFoundHTTPError,
    WebAppAccessUnavailableHTTPError,
)
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from services.installed_app_access_service import (
    InstalledAppAccessDeniedError,
    InstalledAppNotFoundError,
    InstalledAppRef,
)
from services.webapp_access_query_service import WebAppAccessUnavailableError

logger = logging.getLogger(__name__)


def get_installed_app[T, **P, R](
    view: Callable[Concatenate[T, RequestContext, InstalledAppRef, P], R],
) -> Callable[Concatenate[T, RequestContext, P], R]:
    """Resolve the route's installation after Console account admission."""

    @wraps(view)
    def decorated(self: T, request_context: RequestContext, /, *args: P.args, **kwargs: P.kwargs) -> R:
        installed_app_id = kwargs.pop("installed_app_id", None)
        if installed_app_id is None:
            raise RuntimeError("The installed-app admission route must provide installed_app_id")
        try:
            installed_app = application_services().installed_app_access.get_access(
                installed_app_id=str(installed_app_id),
                tenant_id=request_context.active_workspace_id,
                account_id=request_context.account_id,
            )
        except InstalledAppNotFoundError as error:
            raise InstalledAppNotFoundHTTPError() from error
        except InstalledAppAccessDeniedError as error:
            raise AppAccessDeniedError() from error
        except WebAppAccessUnavailableError as error:
            logger.exception(
                "Installed app admission access check failed: installed_app_id=%s workspace_id=%s "
                "account_id=%s request_id=%s",
                installed_app_id,
                request_context.active_workspace_id,
                request_context.account_id,
                request_context.request_id,
            )
            raise WebAppAccessUnavailableHTTPError() from error
        return view(self, request_context, installed_app, *args, **kwargs)

    return decorated
