"""Service API admission for handlers that consume stable app and end-user values."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from controllers.common.errors import UnauthorizedError
from controllers.service_api.app import error as http_errors
from controllers.service_api.wraps import (
    FetchUserArg,
    document_app_token_contract,
    resolve_service_api_end_user,
    validate_and_get_api_token,
)
from extensions.ext_application_services import application_services
from machinery.context import ServiceApiEndUserContext, ServiceApiRequestContext
from services.app_definition_query_service import AppDefinitionUnavailableError, ServiceApiAppRecord
from services.errors.app import AppAbnormalStatusError, AppApiDisabledError
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError


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
            app = _admit_service_api_app()

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


def service_api_app_admission[T, **P, R](
    view: Callable[Concatenate[T, ServiceApiRequestContext, P], R],
) -> Callable[Concatenate[T, P], R]:
    """Admit app-token queries without an end user or request-scoped ORM session.

    Retain the legacy active-workspace/owner requirement without logging in that
    owner: handlers consume only the token's app scope, not an Account identity.
    """

    @wraps(view)
    def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        app = _admit_service_api_app()
        if not application_services().app_definitions.has_service_api_owner(app.tenant_id):
            raise UnauthorizedError("Tenant owner account not found or tenant is not active.")
        return view(self, ServiceApiRequestContext(tenant_id=app.tenant_id, app_id=app.app_id), *args, **kwargs)

    document_app_token_contract(admitted, None)
    return admitted


def _admit_service_api_app() -> ServiceApiAppRecord:
    token = validate_and_get_api_token("app")
    try:
        return application_services().app_definitions.get_service_api_app(token.app_id)
    except AppDefinitionUnavailableError as error:
        raise http_errors.AppNotFoundError() from error
    except AppAbnormalStatusError as error:
        raise http_errors.AppAbnormalStatusError() from error
    except AppApiDisabledError as error:
        raise http_errors.AppApiDisabledError() from error
    except WorkspaceNotFoundError as error:
        raise http_errors.WorkspaceNotFoundError() from error
    except WorkspaceArchivedError as error:
        raise http_errors.WorkspaceArchivedError() from error
