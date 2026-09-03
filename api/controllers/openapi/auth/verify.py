from __future__ import annotations

from flask import request
from werkzeug.exceptions import Forbidden, NotFound, UnprocessableEntity

from configs import dify_config
from controllers.common.wraps import enforce_rbac_access
from controllers.openapi.auth.data import AuthData, CallerKind
from extensions.ext_database import db
from libs.oauth_bearer import Scope, TokenType
from services.account_service import AccountService, TenantService
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode


def check_scope(data: AuthData) -> None:
    if data.required_scope is None:
        return
    if Scope.FULL in data.scopes or data.required_scope in data.scopes:
        return
    raise Forbidden("insufficient_scope")


def check_workspace_member(data: AuthData) -> None:
    """Assert the caller belongs to the resolved tenant.

    `load_workspace_role` stashes the membership role (None when the caller is
    not a member or is inactive). A missing membership surfaces as 404, not
    403, so workspace IDs don't leak across tenants.
    """
    if data.tenant_role is None:
        raise NotFound("workspace not found")


def check_workspace_mismatch(data: AuthData) -> None:
    if data.tenant is None:
        return
    request_workspace_id = data.path_params.get("workspace_id") or request.args.get("workspace_id")
    if request_workspace_id and request_workspace_id != str(data.tenant.id):
        raise UnprocessableEntity("workspace_id does not match app's workspace")


def check_workspace_role(data: AuthData) -> None:
    if dify_config.RBAC_ENABLED and data.rbac is not None:
        # fine-grained permission check is performed by RBAC
        return
    if data.allowed_roles is None:
        return
    if data.tenant_role is None:
        raise NotFound("workspace not found")
    if data.tenant_role not in data.allowed_roles:
        raise Forbidden("insufficient workspace role")


def check_rbac_permission(data: AuthData) -> None:
    req = data.rbac
    if req is None:
        return
    if not dify_config.RBAC_ENABLED:
        return
    # Only account callers are subject to RBAC; end_user access is scope-controlled.
    if data.caller_kind != CallerKind.ACCOUNT:
        return
    if data.account_id is None or data.tenant is None:
        raise Forbidden("rbac context missing")
    enforce_rbac_access(
        tenant_id=str(data.tenant.id),
        account_id=str(data.account_id),
        resource_type=req.resource_type,
        scene=req.scene,
        resource_required=req.resource_required,
        path_args=dict(data.path_params),
    )


def check_app_api_enabled(data: AuthData) -> None:
    if data.app is None:
        return
    if not data.app.enable_api:
        raise Forbidden("service_api_disabled")


def check_app_access(data: AuthData) -> None:
    if data.tenant is None:
        return
    if not TenantService.account_belongs_to_tenant(data.account_id, data.tenant.id, session=db.session()):
        raise Forbidden("subject_no_app_access")


_ALLOWED_MODES_BY_TOKEN_TYPE: dict[TokenType, frozenset[WebAppAccessMode]] = {
    TokenType.OAUTH_ACCOUNT: frozenset(
        {
            WebAppAccessMode.PUBLIC,
            WebAppAccessMode.SSO_VERIFIED,
            WebAppAccessMode.PRIVATE_ALL,
            WebAppAccessMode.PRIVATE,
        }
    ),
    TokenType.OAUTH_EXTERNAL_SSO: frozenset(
        {
            WebAppAccessMode.PUBLIC,
            WebAppAccessMode.SSO_VERIFIED,
        }
    ),
}


def check_acl(data: AuthData) -> None:
    if data.app is None or data.app_access_mode is None:
        raise Forbidden("app or access mode not loaded")
    allowed_modes = _ALLOWED_MODES_BY_TOKEN_TYPE.get(data.token_type, frozenset())
    if data.app_access_mode not in allowed_modes:
        raise Forbidden("subject_not_allowed_for_access_mode")


def check_private_app_permission(data: AuthData) -> None:
    if data.app is None:
        raise Forbidden("app not loaded")
    user_id = _resolve_user_id(data)
    if user_id is None:
        raise Forbidden("cannot resolve user for private app check")
    if not EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(user_id=user_id, app_id=data.app.id):
        raise Forbidden("user_not_allowed_for_private_app")


def _resolve_user_id(data: AuthData) -> str | None:
    if data.token_type == TokenType.OAUTH_ACCOUNT:
        return str(data.account_id) if data.account_id is not None else None
    if data.external_identity is None:
        return None
    account = AccountService.get_account_by_email(data.external_identity.email, session=db.session())
    return str(account.id) if account is not None else None
