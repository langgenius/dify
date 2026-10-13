"""Service API admission for handlers that consume stable app and end-user values."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import request

from controllers.common.resource_access_token_errors import resource_access_token_errors
from controllers.service_api.app import error as http_errors
from controllers.service_api.wraps import (
    FetchUserArg,
    document_app_token_contract,
    peek_service_api_bearer_token,
    resolve_service_api_end_user,
    validate_and_get_api_token,
)
from extensions.ext_application_services import application_services
from machinery.context import ServiceApiEndUserContext
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.auth.resource_access_token_contracts import is_resource_access_token
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
            auth_token = peek_service_api_bearer_token()
            tenant_id = None
            if auth_token and is_resource_access_token(auth_token):
                with resource_access_token_errors():
                    grant = application_services().resource_access_tokens.resolve_app_for_service_api(
                        token=auth_token,
                        requested_app_id=request.headers.get("X-Dify-App-ID"),
                    )
                app_id = next(iter(grant.app_ids))
                tenant_id = grant.tenant_id
            else:
                token = validate_and_get_api_token("app")
                app_id = token.app_id
            try:
                app = application_services().app_definitions.get_service_api_app(app_id, tenant_id=tenant_id)
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
