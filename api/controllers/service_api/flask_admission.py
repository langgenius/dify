"""Service API admission for handlers that consume stable app and end-user values."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from werkzeug.exceptions import Forbidden

from controllers.service_api.wraps import (
    FetchUserArg,
    document_app_token_contract,
    resolve_service_api_end_user,
    validate_and_get_api_token,
)
from extensions.ext_application_services import application_services
from machinery.context import ServiceApiEndUserContext
from models.account import TenantStatus
from models.enums import AppStatus


def service_api_end_user_admission[T, **P, R](
    *,
    fetch_user_arg: FetchUserArg,
) -> Callable[
    [Callable[Concatenate[T, ServiceApiEndUserContext, P], R]],
    Callable[Concatenate[T, P], R],
]:
    """Validate API access before provisioning an end user and injecting scalar identity.

    App/workspace reads finish before user provisioning or the handler runs. The
    shared login helper retains Flask's request identity for legacy dependencies;
    neither an ORM object nor its session is passed to the handler.
    """

    def decorator(
        view: Callable[Concatenate[T, ServiceApiEndUserContext, P], R],
    ) -> Callable[Concatenate[T, P], R]:
        @wraps(view)
        def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
            token = validate_and_get_api_token("app")
            if token.app_id is None:
                raise Forbidden("The app no longer exists.")
            app = application_services().app_definitions.get_service_api_record(token.app_id)
            if app is None:
                raise Forbidden("The app no longer exists.")
            if app.status != AppStatus.NORMAL:
                raise Forbidden("The app's status is abnormal.")
            if not app.enable_api:
                raise Forbidden("The app's API service has been disabled.")
            if app.tenant_status is None:
                raise ValueError("Tenant does not exist.")
            if app.tenant_status == TenantStatus.ARCHIVE:
                raise Forbidden("The workspace's status is archived.")

            end_user = resolve_service_api_end_user(
                tenant_id=app.tenant_id, app_id=app.app_id, fetch_user_arg=fetch_user_arg
            )
            context = ServiceApiEndUserContext(
                tenant_id=app.tenant_id,
                app_id=app.app_id,
                app_mode=app.mode,
                end_user_id=end_user.id,
            )
            return view(self, context, *args, **kwargs)

        document_app_token_contract(admitted, fetch_user_arg)
        return admitted

    return decorator
