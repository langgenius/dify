"""Console authentication and authorization dependencies for API v2."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, cast

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from api_fastapi.dependencies.infra import SyncSessionDep
from api_fastapi.exceptions import (
    AccountBannedError,
    AccountNotInitializedError,
    CsrfTokenError,
    ForbiddenError,
    InvalidAuthTokenError,
    UnauthorizedError,
)
from libs.passport import PassportService
from libs.token import extract_access_token, extract_csrf_token, extract_csrf_token_from_cookie
from models import Account
from models.account import AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole


@dataclass(frozen=True)
class CurrentAccount:
    """Authenticated console account with tenant context for API v2 routes."""

    account: Account
    tenant_id: str
    role: TenantAccountRole


def get_current_account(request: Request, session: SyncSessionDep) -> CurrentAccount:
    """Load the authenticated account and current tenant for console routes.

    Accepts console bearer/cookie access tokens. Unsafe methods require the
    CSRF header/cookie pair used by console requests. Tenant selection is part
    of the auth contract: prefer the explicit current tenant membership, falling
    back to the first membership and marking it current.
    """

    token = extract_access_token(cast(Any, request))
    if not token:
        raise InvalidAuthTokenError()

    try:
        decoded = PassportService().verify(token)
    except Exception as exc:
        raise InvalidAuthTokenError(_exception_message(exc)) from exc

    account_id = decoded.get("user_id")
    token_source = decoded.get("token_source")
    if token_source or not isinstance(account_id, str):
        raise InvalidAuthTokenError()

    account = session.get(Account, account_id)
    if account is None:
        raise UnauthorizedError()
    if account.status == AccountStatus.BANNED:
        raise AccountBannedError()
    if account.status == AccountStatus.UNINITIALIZED:
        raise AccountNotInitializedError()

    _check_csrf_token_for_fastapi(request, account.id)

    tenant_join = _load_current_tenant_join(session, account.id)
    if tenant_join is None:
        raise UnauthorizedError()

    tenant = session.get(Tenant, tenant_join.tenant_id)
    if tenant is None:
        raise UnauthorizedError()

    account.role = TenantAccountRole(tenant_join.role)
    account._current_tenant = tenant
    return CurrentAccount(account=account, tenant_id=tenant.id, role=TenantAccountRole(tenant_join.role))


CurrentAccountDep = Annotated[CurrentAccount, Depends(get_current_account)]


def require_editor(current_account: CurrentAccountDep) -> CurrentAccount:
    """Require a workspace role that can edit workflow drafts."""

    if not TenantAccountRole.is_editing_role(current_account.role):
        raise ForbiddenError()
    return current_account


EditorAccountDep = Annotated[CurrentAccount, Depends(require_editor)]


UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _check_csrf_token_for_fastapi(request: Request, account_id: str) -> None:
    if request.method not in UNSAFE_METHODS:
        return

    header_token = extract_csrf_token(cast(Any, request))
    cookie_token = extract_csrf_token_from_cookie(cast(Any, request))
    if not header_token or header_token != cookie_token:
        raise CsrfTokenError()

    try:
        verified = PassportService().verify(header_token)
    except Exception as exc:
        raise CsrfTokenError() from exc

    if verified.get("sub") != account_id:
        raise CsrfTokenError()


def _load_current_tenant_join(session: Session, account_id: str) -> TenantAccountJoin | None:
    current_join = session.scalar(
        select(TenantAccountJoin)
        .where(TenantAccountJoin.account_id == account_id, TenantAccountJoin.current.is_(True))
        .limit(1)
    )
    if current_join:
        return current_join

    fallback_join = session.scalar(
        select(TenantAccountJoin)
        .where(TenantAccountJoin.account_id == account_id)
        .order_by(TenantAccountJoin.id.asc())
        .limit(1)
    )
    if fallback_join:
        fallback_join.current = True
    return fallback_join


def _exception_message(exc: Exception) -> str:
    description = getattr(exc, "description", None)
    return str(description or exc)
