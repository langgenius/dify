"""Service API admission for handlers that consume stable app and actor identities."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import request

from controllers.common.errors import ForbiddenError, InvalidArgumentError, NotFoundError, UnauthorizedError
from controllers.service_api.app import error as http_errors
from controllers.service_api.wraps import (
    FetchUserArg,
    document_app_token_contract,
    peek_service_api_bearer_token,
    resolve_service_api_end_user,
    validate_and_get_api_token,
)
from core.logging.context import set_identity_context
from extensions.ext_application_services import application_services
from extensions.otel.runtime import set_identity_span_attributes
from libs.external_api import document_errors
from machinery.context import AppRequestContext, ServiceApiAccountRequestContext, ServiceApiEndUserContext
from services.app_definition_query_service import AppDefinitionUnavailableError, ServiceApiAppRecord
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInputError,
    ResourceAccessTokenInvalidError,
    ResourceAccessTokenNotFoundError,
    is_resource_access_token,
)
from services.errors.app import AppAbnormalStatusError, AppApiDisabledError
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError

_APP_ADMISSION_ERRORS = (
    ForbiddenError,
    http_errors.AppNotFoundError,
    http_errors.AppAbnormalStatusError,
    http_errors.AppApiDisabledError,
    http_errors.WorkspaceNotFoundError,
    http_errors.WorkspaceArchivedError,
)


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
        document_errors(admitted, *_APP_ADMISSION_ERRORS)
        return admitted

    return decorator


def service_api_app_admission[T, **P, R](
    view: Callable[Concatenate[T, AppRequestContext, P], R],
) -> Callable[Concatenate[T, P], R]:
    """Admit app-token queries without an end user or request-scoped ORM session.

    Retain the legacy active-workspace/owner requirement without logging in that
    owner: handlers consume only the token's app scope, not an Account identity.
    """

    @wraps(view)
    def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        app = _admit_service_api_app()
        _require_service_api_owner(app.tenant_id)
        return view(self, AppRequestContext(tenant_id=app.tenant_id, app_id=app.app_id), *args, **kwargs)

    document_app_token_contract(admitted, None)
    document_errors(admitted, *_APP_ADMISSION_ERRORS)
    return admitted


def service_api_account_admission[T, **P, R](
    view: Callable[Concatenate[T, ServiceApiAccountRequestContext, P], R],
) -> Callable[Concatenate[T, P], R]:
    """Admit app access and use its workspace owner for account-backed operations.

    This owner is the legacy attribution identity, not a user authenticated by the token.
    """

    @wraps(view)
    def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        app = _admit_service_api_app()
        context = ServiceApiAccountRequestContext(
            tenant_id=app.tenant_id,
            app_id=app.app_id,
            account_id=_require_service_api_owner(app.tenant_id),
        )
        set_identity_context(tenant_id=context.tenant_id, user_id=context.account_id, user_type="account")
        set_identity_span_attributes(tenant_id=context.tenant_id, user_id=context.account_id)
        return view(self, context, *args, **kwargs)

    document_app_token_contract(admitted, None)
    document_errors(admitted, *_APP_ADMISSION_ERRORS)
    return admitted


def _require_service_api_owner(tenant_id: str) -> str:
    account_id = application_services().app_definitions.get_service_api_owner_id(tenant_id)
    if account_id is None:
        raise UnauthorizedError("Tenant owner account not found or tenant is not active.")
    return account_id


def _admit_service_api_app() -> ServiceApiAppRecord:
    auth_token = peek_service_api_bearer_token()
    if auth_token and is_resource_access_token(auth_token):
        try:
            grant = application_services().resource_access_tokens.resolve_app_for_service_api(
                token=auth_token,
                requested_app_id=request.headers.get("X-Dify-App-ID"),
            )
        except ResourceAccessTokenInputError as error:
            raise InvalidArgumentError(str(error)) from error
        except ResourceAccessTokenForbiddenError as error:
            raise ForbiddenError(str(error)) from error
        except ResourceAccessTokenNotFoundError as error:
            raise NotFoundError(str(error)) from error
        except ResourceAccessTokenInvalidError as error:
            raise UnauthorizedError(str(error)) from error
        app_id = next(iter(grant.app_ids))
        tenant_id = grant.tenant_id
    else:
        token = validate_and_get_api_token("app")
        app_id = token.app_id
        tenant_id = token.tenant_id
    try:
        return application_services().app_definitions.get_service_api_app(app_id, tenant_id=tenant_id)
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
