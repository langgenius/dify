"""Flask admission adapters for Service API app and knowledge requests."""

from collections.abc import Callable
from functools import wraps
from typing import Any, Concatenate, TypedDict, cast
from uuid import UUID

from flask import current_app, request
from flask_login import user_logged_in
from flask_restx import Resource
from flask_restx.utils import merge
from werkzeug.exceptions import Forbidden, NotFound, ServiceUnavailable, Unauthorized

from configs import dify_config
from controllers.common.errors import ForbiddenError, InvalidArgumentError, NotFoundError, UnauthorizedError
from controllers.common.resource_access_token_errors import resource_access_token_errors
from controllers.service_api.app import error as http_errors
from controllers.service_api.wraps import (
    DATASET_TOKEN_AUTH_RESPONSES,
    FetchUserArg,
    document_app_token_contract,
    peek_service_api_bearer_token,
    resolve_service_api_end_user,
    validate_and_get_api_token,
)
from core.logging.context import get_request_id, get_trace_id, set_identity_context
from extensions.ext_application_services import application_services
from extensions.otel.runtime import set_identity_span_attributes
from libs.external_api import document_errors
from libs.login import current_user
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
from services.knowledge.admission.application import DatasetAdmissionIdentityError, DatasetAdmissionPolicy
from services.knowledge.admission.limits import KnowledgeApiLimitsError, KnowledgeApiVectorSpaceUnavailableError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError

VECTOR_SPACE_UNAVAILABLE_RESPONSE = {
    503: (
        "`service_unavailable` : Vector space usage could not be verified. Returned on the Dify Cloud Sandbox "
        "plan only; retry the request later."
    ),
}


class _ViewMetadata(TypedDict, total=False):
    """Metadata carried on Flask view functions by decorators."""

    __apidoc__: dict[str, object]
    __dataset_admission_policy__: DatasetAdmissionPolicy


def _view_metadata(view: Callable[..., object]) -> _ViewMetadata:
    return cast(_ViewMetadata, vars(view))


def dataset_admission[**P, R](
    *,
    rate_limit: bool = False,
    billing_resources: tuple[str, ...] = (),
    require_paid_segments: bool = False,
    require_edit_permission: bool = False,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Declare endpoint policy; the resource applies admission exactly once."""
    policy = DatasetAdmissionPolicy(
        rate_limit=rate_limit,
        billing_resources=billing_resources,
        require_paid_segments=require_paid_segments,
        require_edit_permission=require_edit_permission,
    )

    def declare(view: Callable[P, R]) -> Callable[P, R]:
        metadata = _view_metadata(view)
        if "vector_space" in billing_resources:
            metadata["__apidoc__"] = cast(
                dict[str, object],
                merge(metadata.get("__apidoc__", {}), {"responses": VECTOR_SPACE_UNAVAILABLE_RESPONSE}),
            )
        metadata["__dataset_admission_policy__"] = policy
        return view

    return declare


def _admit_dataset_request[R](view: Callable[..., R]) -> Callable[..., R]:
    policy = _view_metadata(view).get("__dataset_admission_policy__", DatasetAdmissionPolicy())

    @wraps(view)
    def admitted(*args: Any, **kwargs: Any) -> R:
        dataset_id = _dataset_id_from_route(args, kwargs)
        services = application_services()
        auth_token = peek_service_api_bearer_token()
        if auth_token and is_resource_access_token(auth_token):
            with resource_access_token_errors():
                grant = services.resource_access_tokens.resolve_datasets_for_service_api(
                    token=auth_token, dataset_id=dataset_id
                )
                if dataset_id is None and request.method not in {"GET", "HEAD", "OPTIONS"}:
                    raise ResourceAccessTokenForbiddenError(
                        "Resource access token is not allowed to modify knowledge base collections."
                    )
            workspace_id = grant.tenant_id
            api_key_id = None
            resource_dataset_ids = grant.dataset_ids
        else:
            key = validate_and_get_api_token("dataset")
            workspace_id, api_key_id = key.tenant_id, key.id
            resource_dataset_ids = None
        try:
            context = services.knowledge.admission.admit(
                workspace_id=workspace_id,
                api_key_id=api_key_id,
                resource_dataset_ids=resource_dataset_ids,
                dataset_id=dataset_id,
                request_id=get_request_id(),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
                remote_ip=request.remote_addr,
                policy=policy,
            )
            account = services.accounts.identity.get_account_for_workspace(
                context.account_id, context.active_workspace_id
            )
            if account is None:
                raise DatasetAdmissionIdentityError("Tenant owner account does not exist.")
            # Shared infrastructure still consumes Flask-Login identity. Materialize it
            # only here; use cases receive the stable context instead of a LocalProxy.
            current_app.login_manager._update_request_context_with_user(account)  # type: ignore[attr-defined]
            user_logged_in.send(current_app._get_current_object(), user=current_user)  # type: ignore[attr-defined]
            if policy.require_edit_permission and not dify_config.RBAC_ENABLED and not account.has_edit_permission:
                raise Forbidden()
            return view(context, *args, **kwargs)
        except DatasetAdmissionIdentityError as error:
            raise Unauthorized(str(error)) from error
        except DatasetNotFoundError as error:
            raise NotFound(str(error)) from error
        except DatasetAccessDeniedError as error:
            raise Forbidden(str(error)) from error
        except KnowledgeApiVectorSpaceUnavailableError as error:
            raise ServiceUnavailable(str(error)) from error
        except KnowledgeApiLimitsError as error:
            raise Forbidden(str(error)) from error

    return admitted


def _dataset_id_from_route(args: tuple[Any, ...], kwargs: dict[str, Any]) -> str | None:
    dataset_id = kwargs.get("dataset_id")
    if dataset_id is not None:
        return str(dataset_id)
    if not args:
        return None

    candidate = args[0]
    if isinstance(candidate, UUID):
        return str(candidate)
    if isinstance(candidate, str):
        try:
            UUID(candidate)
        except ValueError:
            return None
        return candidate
    return None


class DatasetApiResource(Resource):
    """Authenticate knowledge API callers and inject one admitted RequestContext."""

    __apidoc__ = {"responses": DATASET_TOKEN_AUTH_RESPONSES}
    method_decorators = [_admit_dataset_request]


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
