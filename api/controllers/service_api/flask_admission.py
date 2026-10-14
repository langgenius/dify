"""Flask admission for app-token APIs using a stable workspace owner identity."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import request
from werkzeug.exceptions import Unauthorized

from controllers.common.errors import ForbiddenError, InvalidArgumentError, NotFoundError, UnauthorizedError
from controllers.service_api.wraps import (
    _document_app_token_contract,
    peek_service_api_bearer_token,
    validate_and_get_api_token,
)
from core.logging.context import set_identity_context
from extensions.ext_application_services import application_services
from extensions.otel.runtime import set_identity_span_attributes
from machinery.context import ServiceApiAccountRequestContext
from services.app.service_api_access_service import (
    ServiceApiAppAccessDeniedError,
    ServiceApiOwnerNotFoundError,
    ServiceApiWorkspaceNotFoundError,
)
from services.auth.resource_access_token_contracts import (
    ResourceAccessTokenForbiddenError,
    ResourceAccessTokenInputError,
    ResourceAccessTokenInvalidError,
    ResourceAccessTokenNotFoundError,
    is_resource_access_token,
)


def service_api_account_admission[T, **P, R](
    view: Callable[Concatenate[T, ServiceApiAccountRequestContext, P], R],
) -> Callable[Concatenate[T, P], R]:
    """Authenticate an app credential and inject its app scope and workspace owner."""

    @wraps(view)
    def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        try:
            auth_token = peek_service_api_bearer_token()
        except ValueError as error:
            raise UnauthorizedError("Authorization header must include a Bearer token.") from error
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
            try:
                api_token = validate_and_get_api_token("app")
            except Unauthorized as error:
                raise UnauthorizedError(error.description) from error
            app_id = api_token.app_id
            tenant_id = api_token.tenant_id

        try:
            context = application_services().service_api_app_access.resolve_account(app_id=app_id, tenant_id=tenant_id)
        except ServiceApiAppAccessDeniedError as error:
            raise ForbiddenError(str(error)) from error
        except ServiceApiWorkspaceNotFoundError as error:
            raise InvalidArgumentError(str(error)) from error
        except ServiceApiOwnerNotFoundError as error:
            raise UnauthorizedError(str(error)) from error
        set_identity_context(tenant_id=context.tenant_id, user_id=context.account_id, user_type="account")
        set_identity_span_attributes(tenant_id=context.tenant_id, user_id=context.account_id)
        return view(self, context, *args, **kwargs)

    _document_app_token_contract(admitted, None)
    return admitted
