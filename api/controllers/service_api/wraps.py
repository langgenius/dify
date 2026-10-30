import logging
from collections.abc import Callable
from enum import StrEnum, auto
from functools import wraps
from typing import Protocol, cast, overload

from flask import current_app, request
from flask_login import user_logged_in
from flask_restx.utils import merge
from pydantic import BaseModel
from sqlalchemy import select
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.common.access_response import MISSING_BEARER_MESSAGE
from controllers.common.resource_access_token_errors import resource_access_token_errors
from controllers.service_api.schema import (
    USER_FETCH_FROM_ATTR,
    USER_FORM_PARAM,
    USER_QUERY_PARAM,
    USER_REQUIRED_ATTR,
)
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from libs.login import current_user
from models import Account, Tenant, TenantAccountJoin, TenantStatus
from models.model import ApiToken
from services.api_token_service import ApiTokenCache, fetch_token_with_single_flight, record_token_usage
from services.app_service import AppService
from services.auth.resource_access_token_contracts import is_resource_access_token

logger = logging.getLogger(__name__)


class _RestxDocumentedView(Protocol):
    """Callable view object carrying Flask-RESTX documentation metadata."""

    __apidoc__: dict[str, object]


class WhereisUserArg(StrEnum):
    """
    Enum for whereis_user_arg.
    """

    QUERY = auto()
    JSON = auto()
    FORM = auto()


class FetchUserArg(BaseModel):
    fetch_from: WhereisUserArg
    required: bool = False


APP_TOKEN_FORBIDDEN_RESPONSE = {
    403: "Forbidden - token scope, app, dataset, or workspace access denied",
}

DATASET_TOKEN_AUTH_RESPONSES = {
    401: "Unauthorized - invalid API token",
    403: "Forbidden - dataset API access or workspace access denied",
}


def _document_app_token_contract(view_func: Callable[..., object], fetch_user_arg: FetchUserArg | None) -> None:
    doc: dict[str, object] = {"responses": APP_TOKEN_FORBIDDEN_RESPONSE}
    if fetch_user_arg is not None:
        setattr(view_func, USER_FETCH_FROM_ATTR, fetch_user_arg.fetch_from.name)
        setattr(view_func, USER_REQUIRED_ATTR, fetch_user_arg.required)
        match fetch_user_arg.fetch_from:
            case WhereisUserArg.QUERY:
                doc["params"] = {"user": {**USER_QUERY_PARAM, "required": fetch_user_arg.required}}
            case WhereisUserArg.FORM:
                doc["params"] = {"user": {**USER_FORM_PARAM, "required": fetch_user_arg.required}}
            case WhereisUserArg.JSON:
                pass

    cast(_RestxDocumentedView, view_func).__apidoc__ = cast(
        dict[str, object],
        merge(getattr(view_func, "__apidoc__", {}), doc),
    )


@overload
def validate_app_token[**P, R](view: Callable[P, R]) -> Callable[P, R]: ...


@overload
def validate_app_token[**P, R](
    view: None = None, *, fetch_user_arg: FetchUserArg | None = None
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def validate_app_token[**P, R](
    view: Callable[P, R] | None = None, *, fetch_user_arg: FetchUserArg | None = None
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(view_func: Callable[P, R]) -> Callable[P, R]:
        @wraps(view_func)
        def decorated_view(*args: P.args, **kwargs: P.kwargs) -> R:
            auth_token = peek_service_api_bearer_token()
            if auth_token and is_resource_access_token(auth_token):
                with resource_access_token_errors():
                    grant = application_services().resource_access_tokens.resolve_app_for_service_api(
                        token=auth_token,
                        requested_app_id=request.headers.get("X-Dify-App-ID"),
                    )
                app_model = AppService.get_app_in_workspace(
                    tenant_id=grant.tenant_id,
                    app_id=next(iter(grant.app_ids)),
                    session=db.session(),
                )
            else:
                api_token = validate_and_get_api_token("app")
                app_model = AppService.get_app_by_id(api_token.app_id, session=db.session())
            if not app_model:
                raise Forbidden("The app no longer exists.")

            if app_model.status != "normal":
                raise Forbidden("The app's status is abnormal.")

            if not app_model.enable_api:
                raise Forbidden("The app's API service has been disabled.")

            tenant = db.session.get(Tenant, app_model.tenant_id)
            if tenant is None:
                raise ValueError("Tenant does not exist.")
            if tenant.status == TenantStatus.ARCHIVE:
                raise Forbidden("The workspace's status is archived.")

            kwargs["app_model"] = app_model

            # If caller needs end-user context, attach EndUser to current_user
            if fetch_user_arg:
                user_id = None
                match fetch_user_arg.fetch_from:
                    case WhereisUserArg.QUERY:
                        user_id = request.args.get("user")
                    case WhereisUserArg.JSON:
                        user_id = request.get_json().get("user")
                    case WhereisUserArg.FORM:
                        user_id = request.form.get("user")

                if not user_id and fetch_user_arg.required:
                    raise ValueError("Arg user must be provided.")

                if user_id:
                    user_id = str(user_id)

                end_user = application_services().app_scoped_end_users.commands.get_or_create_end_user(
                    app_model.tenant_id,
                    app_model.id,
                    user_id,
                )
                kwargs["end_user"] = end_user

                # Set EndUser as current logged-in user for flask_login.current_user
                current_app.login_manager._update_request_context_with_user(end_user)  # type: ignore
                user_logged_in.send(current_app._get_current_object(), user=end_user)  # type: ignore
            else:
                # For service API without end-user context, ensure an Account is logged in
                # so services relying on current_account_with_tenant() work correctly.
                tenant_owner_info = db.session.execute(
                    select(Tenant, Account)
                    .join(TenantAccountJoin, Tenant.id == TenantAccountJoin.tenant_id)
                    .join(Account, TenantAccountJoin.account_id == Account.id)
                    .where(
                        Tenant.id == app_model.tenant_id,
                        TenantAccountJoin.role == "owner",
                        Tenant.status == TenantStatus.NORMAL,
                    )
                ).one_or_none()

                if tenant_owner_info:
                    tenant_model, account = tenant_owner_info
                    account.set_current_tenant_with_session(tenant_model, session=db.session())
                    current_app.login_manager._update_request_context_with_user(account)  # type: ignore
                    user_logged_in.send(current_app._get_current_object(), user=current_user)  # type: ignore
                else:
                    raise Unauthorized("Tenant owner account not found or tenant is not active.")

            return view_func(*args, **kwargs)

        _document_app_token_contract(decorated_view, fetch_user_arg)
        return decorated_view

    if view is None:
        return decorator
    else:
        return decorator(view)


def validate_and_get_api_token(scope: str | None = None):
    """
    Validate and get API token with Redis caching.

    This function uses a two-tier approach:
    1. First checks Redis cache for the token
    2. If not cached, queries database and caches the result

    The last_used_at field is updated asynchronously via Celery task
    to avoid blocking the request.
    """
    auth_token = extract_service_api_bearer_token()

    # Try to get token from cache first
    # Returns a CachedApiToken (plain Python object), not a SQLAlchemy model
    cached_token = ApiTokenCache.get(auth_token, scope)
    if cached_token is not None:
        logger.debug("Token validation served from cache for scope: %s", scope)
        # Record usage in Redis for later batch update (no Celery task per request)
        record_token_usage(auth_token, scope)
        return cast(ApiToken, cached_token)

    # Cache miss - use Redis lock for single-flight mode
    # This ensures only one request queries DB for the same token concurrently
    return fetch_token_with_single_flight(auth_token, scope)


def extract_service_api_bearer_token() -> str:
    auth_token = peek_service_api_bearer_token()
    if auth_token is None:
        raise Unauthorized(MISSING_BEARER_MESSAGE)
    return auth_token


def peek_service_api_bearer_token() -> str | None:
    # Match the Gateway's HTTP SP/HTAB parser for both API keys and resource
    # access tokens. Unicode whitespace must not bypass policy identity lookup.
    auth_header = request.headers.get("Authorization") or ""
    auth_parts = [part for part in auth_header.replace("\t", " ").split(" ") if part]
    if len(auth_parts) != 2 or auth_parts[0].lower() != "bearer":
        return None
    return auth_parts[1]
