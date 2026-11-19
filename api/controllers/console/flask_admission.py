"""Flask adapter for Console API admission."""

from collections.abc import Callable, Sequence
from functools import wraps
from http import HTTPStatus
from typing import Concatenate

from flask import Response, abort, g, request
from werkzeug.exceptions import Forbidden, Unauthorized

from configs import dify_config
from controllers.common.rbac import RBAC_CHECKS_ATTR, RBACCheck, enforce_rbac_checks
from controllers.console.admin import admin_required
from controllers.console.error import NotAllowedCreateWorkspace, WorkspacesLimitExceeded
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    enable_change_email,
    enterprise_license_required,
    is_allow_transfer_owner,
    setup_required,
)
from core.logging.context import get_request_id, get_trace_id, set_identity_context
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from extensions.ext_login import ACCOUNT_ONLY_ADMISSION_ATTR, load_account
from libs.login import current_account_with_tenant, current_account_with_tenant_optional, login_required
from libs.oauth_bearer import bearer_feature_required
from libs.token import extract_console_cookie_token, is_admin_api_key_request
from machinery.context import AccountRequestContext, RequestContext
from models.account import AccountStatus
from services.errors.workspace import (
    WorkSpaceNotAllowedCreateError,
    WorkspaceNotFoundError,
    WorkspaceOwnerNotFoundError,
    WorkspacesLimitExceededError,
)
from services.system_feature_service import SystemFeatureService


def console_personal_account_admission[T, **P, R](
    view: Callable[Concatenate[T, AccountRequestContext, P], R],
) -> Callable[Concatenate[T, P], R | Response]:
    """Require an active browser account and CSRF, without an active workspace."""

    @wraps(view)
    def inject_account_context(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        account, _ = current_account_with_tenant_optional()
        if account is None or account.status != AccountStatus.ACTIVE:
            raise Unauthorized("Active account required.")
        context = AccountRequestContext(
            account_id=account.id,
            request_id=get_request_id(),
            trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
        )
        return view(self, context, *args, **kwargs)

    authenticated = login_required(inject_account_context)

    @wraps(view)
    def require_browser_session(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R | Response:
        # Generic Console login also admits admin-key impersonation. Personal
        # credentials must only be managed by the holder's browser session.
        if is_admin_api_key_request(request) or not extract_console_cookie_token(request):
            raise Unauthorized("Personal access tokens require a browser session.")
        return authenticated(self, *args, **kwargs)

    admitted = setup_required(require_browser_session)
    setattr(admitted, ACCOUNT_ONLY_ADMISSION_ATTR, True)
    return admitted


def console_admin_admission[T, **P, R](
    view: Callable[Concatenate[T, P], R],
) -> Callable[Concatenate[T, P], R]:
    """Admit a configured admin API key without requiring a Console account."""

    return setup_required(admin_required(view))


def console_email_registration_admission[T, **P, R](
    view: Callable[Concatenate[T, P], R],
) -> Callable[Concatenate[T, P], R | Response]:
    """Apply the complete admission policy for anonymous email registration."""

    @wraps(view)
    def check_registration_features(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        if (
            not SystemFeatureService.is_email_password_login_enabled()
            or not SystemFeatureService.is_registration_allowed()
        ):
            abort(403)
        return view(self, *args, **kwargs)

    return setup_required(check_registration_features)


def console_account_identity_admission[T, **P, R](
    view: Callable[Concatenate[T, AccountRequestContext, P], R],
) -> Callable[Concatenate[T, P], R | Response]:
    """Admit Cloud Accounts before workspace creation; retain other editions' initialization gate."""

    @wraps(view)
    def inject(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        account, _ = current_account_with_tenant_optional()
        if account is None:
            raise Unauthorized()
        context = AccountRequestContext(
            account_id=account.id,
            request_id=get_request_id(),
            trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
        )
        return view(self, context, *args, **kwargs)

    initialized = account_initialization_required(inject)

    @wraps(view)
    def admit(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            return inject(self, *args, **kwargs)
        return initialized(self, *args, **kwargs)

    return setup_required(login_required(admit))


def _bootstrap_console_workspace() -> None:
    """Resolve a first workspace for a Cloud browser session on opted-in Console GETs.

    Requires login and CSRF validation first. Only a workspace-less Account with
    no recorded Builder origin may provision. Success reloads the admitted Account
    with its committed membership before workspace admission. Provisioning denials
    leave workspace state unchanged and become normal admission errors.
    """
    if (
        dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD
        or dify_config.LOGIN_DISABLED
        or request.method != "GET"
        or not extract_console_cookie_token(request)
        or is_admin_api_key_request(request)
    ):
        return

    account, workspace_id = current_account_with_tenant_optional()
    if account is None:
        return
    if workspace_id is None:
        if account.first_workspace_created_at is not None or account.status not in (
            AccountStatus.ACTIVE,
            AccountStatus.UNINITIALIZED,
        ):
            raise Forbidden("An active workspace is required.")
        try:
            application_services().workspaces.provisioning.activate(account.id)
        except WorkspaceOwnerNotFoundError as error:
            raise Unauthorized() from error
        except WorkSpaceNotAllowedCreateError as error:
            raise Forbidden(NotAllowedCreateWorkspace.description) from error
        except WorkspacesLimitExceededError as error:
            raise Forbidden(WorkspacesLimitExceeded.description) from error
        except WorkspaceNotFoundError as error:
            raise Forbidden("An active workspace is required.") from error
    elif account.status != AccountStatus.UNINITIALIZED:
        return

    # Another bootstrap read can commit between loading the Account and its membership.
    refreshed = load_account(account.id)
    if refreshed is None:
        raise Unauthorized()
    active_workspace_id = refreshed.current_tenant_id
    if active_workspace_id is None:
        raise Forbidden("An active workspace is required.")
    g._login_user = refreshed
    set_identity_context(tenant_id=active_workspace_id, user_id=refreshed.id, user_type="account")


def console_account_admission[T, **P, R](
    *,
    editions: frozenset[DeploymentEdition] | None = None,
    require_change_email_enabled: bool = False,
    require_initialized: bool = True,
    bootstrap_workspace: bool = False,
    require_valid_enterprise_license: bool = False,
    require_owner_transfer_enabled: bool = False,
    billing_resource: str | None = None,
    require_oauth_bearer_enabled: bool = False,
    allowed_roles: frozenset[TenantAccountRole] | None = None,
    rbac_checks: Sequence[RBACCheck] | None = None,
) -> Callable[
    [Callable[Concatenate[T, RequestContext, P], R]],
    Callable[Concatenate[T, P], R | Response],
]:
    """Declare Console account admission and inject a stable RequestContext.

    Checks run in a fixed order: setup, login/CSRF, optional Cloud workspace
    bootstrap, optional account initialization, edition, license, feature and
    billing checks, role/RBAC checks, then context construction. Only Console
    bootstrap reads opt in to provisioning; other routes require existing context.
    """

    def decorator(
        view: Callable[Concatenate[T, RequestContext, P], R],
    ) -> Callable[Concatenate[T, P], R | Response]:
        @wraps(view)
        def inject_request_context(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
            account_with_tenant = current_account_with_tenant()
            account = account_with_tenant.account
            tenant_id = account_with_tenant.tenant_id
            if allowed_roles is not None and not dify_config.RBAC_ENABLED and account.role not in allowed_roles:
                raise Forbidden()
            if rbac_checks is not None:
                enforce_rbac_checks(
                    tenant_id=tenant_id,
                    account_id=account.id,
                    checks=rbac_checks,
                    path_args=kwargs,
                )
            request_context = RequestContext(
                account_id=account.id,
                active_workspace_id=tenant_id,
                request_id=get_request_id(),
                trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
            )
            return view(self, request_context, *args, **kwargs)

        if rbac_checks is not None:
            setattr(inject_request_context, RBAC_CHECKS_ATTR, rbac_checks)

        admitted: Callable[Concatenate[T, P], R | Response] = inject_request_context
        if billing_resource is not None:
            admitted = cloud_edition_billing_resource_check(billing_resource)(admitted)
        if require_change_email_enabled:
            admitted = enable_change_email(admitted)
        if require_owner_transfer_enabled:
            admitted = is_allow_transfer_owner(admitted)
        if require_oauth_bearer_enabled:
            admitted = bearer_feature_required(admitted)
        if require_valid_enterprise_license:
            admitted = enterprise_license_required(admitted)
        if editions is not None:
            admitted = enforce_edition(admitted)
        if require_initialized:
            admitted = account_initialization_required(admitted)
        if bootstrap_workspace:
            admitted = with_workspace_bootstrap(admitted)
        return setup_required(login_required(admitted))

    def with_workspace_bootstrap(
        admitted: Callable[Concatenate[T, P], R | Response],
    ) -> Callable[Concatenate[T, P], R | Response]:
        """Bootstrap after authentication, then apply the unchanged workspace checks."""

        @wraps(admitted)
        def checked(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R | Response:
            _bootstrap_console_workspace()
            return admitted(self, *args, **kwargs)

        return checked

    def enforce_edition(
        admitted: Callable[Concatenate[T, P], R | Response],
    ) -> Callable[Concatenate[T, P], R | Response]:
        @wraps(admitted)
        def checked(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R | Response:
            if editions is not None and dify_config.DEPLOYMENT_EDITION not in editions:
                abort(HTTPStatus.NOT_FOUND)
            return admitted(self, *args, **kwargs)

        return checked

    return decorator
