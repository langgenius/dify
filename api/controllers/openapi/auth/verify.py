from __future__ import annotations

from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.data import AuthData
from extensions.ext_database import db
from libs.oauth_bearer import Scope, TokenType, check_workspace_membership
from services.account_service import AccountService, TenantService
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode


def check_scope(data: AuthData) -> None:
    if data.required_scope is None:
        return
    if Scope.FULL in data.scopes or data.required_scope in data.scopes:
        return
    raise Forbidden("insufficient_scope")


def check_membership(data: AuthData) -> None:
    if data.tenant is None:
        raise Unauthorized("tenant unset")
    if data.account_id is None:
        raise Unauthorized("account_id unset")
    check_workspace_membership(
        account_id=data.account_id,
        tenant_id=data.tenant.id,
        token_hash=data.token_hash,
        membership_cache=data.tenants,
    )


def check_app_access(data: AuthData) -> None:
    if data.tenant is None:
        return
    if not TenantService.account_belongs_to_tenant(db.session, data.account_id, data.tenant.id):
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
    account = AccountService.get_account_by_email(db.session, data.external_identity.email)
    return str(account.id) if account is not None else None
