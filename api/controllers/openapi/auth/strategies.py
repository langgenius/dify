"""Strategy classes for the openapi auth pipeline.

App authorization (Acl/Membership) and caller mounting (Account/EndUser)
vary along independent axes; each strategy is one class so the pipeline
composition stays a flat list.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from flask import current_app
from flask_login import user_logged_in
from sqlalchemy import select

from controllers.openapi.auth.context import Context
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from libs.oauth_bearer import SubjectType
from models import Account, TenantAccountJoin
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import (
    EnterpriseService,
    WebAppAccessMode,
)


class AppAuthzStrategy(Protocol):
    def authorize(self, ctx: Context) -> bool: ...


class AclStrategy:
    """Per-app ACL, evaluated in two stages.

    The EE gateway has already enforced tenancy and workspace membership
    by the time this strategy runs, so AclStrategy only owns per-app ACL:

    1. Subject vs access-mode compatibility (pure rule table). External-SSO
       bearers belong to public-facing apps only; account bearers cover the
       full set. A mismatch is an immediate deny — no IO.
    2. For modes that pair with the subject, decide whether the inner
       permission API must run. Only `PRIVATE` (per-app selected-user list)
       requires it; the remaining modes are pass-through.
    """

    _ALLOWED_MODES_BY_SUBJECT: dict[SubjectType, frozenset[WebAppAccessMode]] = {
        SubjectType.ACCOUNT: frozenset(
            {
                WebAppAccessMode.PUBLIC,
                WebAppAccessMode.SSO_VERIFIED,
                WebAppAccessMode.PRIVATE_ALL,
                WebAppAccessMode.PRIVATE,
            }
        ),
        SubjectType.EXTERNAL_SSO: frozenset(
            {
                WebAppAccessMode.PUBLIC,
                WebAppAccessMode.SSO_VERIFIED,
            }
        ),
    }

    _MODES_REQUIRING_INNER_CHECK: frozenset[WebAppAccessMode] = frozenset({WebAppAccessMode.PRIVATE})

    def authorize(self, ctx: Context) -> bool:
        if ctx.app is None:
            return False
        access_mode = self._fetch_access_mode(ctx.app.id)
        if access_mode is None:
            return False
        if not self._subject_allowed_for_mode(ctx.subject_type, access_mode):
            return False
        if access_mode not in self._MODES_REQUIRING_INNER_CHECK:
            return True
        return self._inner_permission_check(ctx)

    @staticmethod
    def _fetch_access_mode(app_id: str) -> WebAppAccessMode | None:
        settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=app_id)
        if settings is None:
            return None
        try:
            return WebAppAccessMode(settings.access_mode)
        except ValueError:
            return None

    @classmethod
    def _subject_allowed_for_mode(cls, subject_type: SubjectType, access_mode: WebAppAccessMode) -> bool:
        return access_mode in cls._ALLOWED_MODES_BY_SUBJECT.get(subject_type, frozenset())

    def _inner_permission_check(self, ctx: Context) -> bool:
        if ctx.app is None:
            return False
        user_id = self._resolve_user_id(ctx)
        if user_id is None:
            return False
        return EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(
            user_id=user_id,
            app_id=ctx.app.id,
        )

    @staticmethod
    def _resolve_user_id(ctx: Context) -> str | None:
        if ctx.subject_type == SubjectType.ACCOUNT:
            return str(ctx.account_id) if ctx.account_id is not None else None
        if ctx.subject_email is None:
            return None
        account = db.session.execute(
            select(Account).where(Account.email == ctx.subject_email),
        ).scalar_one_or_none()
        return str(account.id) if account is not None else None


class MembershipStrategy:
    """Tenant-membership fallback.

    Used when webapp-auth is disabled (CE deployment). Account-bearing
    subjects pass if they have a TenantAccountJoin row; EXTERNAL_SSO is
    denied (it requires the webapp-auth surface).
    """

    def authorize(self, ctx: Context) -> bool:
        if ctx.subject_type == SubjectType.EXTERNAL_SSO:
            return False
        if ctx.tenant is None:
            return False
        return _has_tenant_membership(ctx.account_id, ctx.tenant.id)


def _has_tenant_membership(account_id: uuid.UUID | str | None, tenant_id: str) -> bool:
    if not account_id:
        return False
    row = db.session.execute(
        select(TenantAccountJoin.id).where(
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == account_id,
        )
    ).scalar_one_or_none()
    return row is not None


def _login_as(user) -> None:
    """Set Flask-Login request user so downstream services see the caller."""
    current_app.login_manager._update_request_context_with_user(user)
    user_logged_in.send(current_app._get_current_object(), user=user)


class CallerMounter(Protocol):
    def applies_to(self, subject_type: SubjectType) -> bool: ...

    def mount(self, ctx: Context) -> None: ...


class AccountMounter:
    def applies_to(self, subject_type: SubjectType) -> bool:
        return subject_type == SubjectType.ACCOUNT

    def mount(self, ctx: Context) -> None:
        if ctx.account_id is None:
            raise RuntimeError("AccountMounter: account_id unset — BearerCheck did not run")
        account = db.session.get(Account, ctx.account_id)
        if account is None:
            raise RuntimeError("AccountMounter: account row missing for resolved bearer")
        account.current_tenant = ctx.tenant
        _login_as(account)
        ctx.caller, ctx.caller_kind = account, "account"


class EndUserMounter:
    def applies_to(self, subject_type: SubjectType) -> bool:
        return subject_type == SubjectType.EXTERNAL_SSO

    def mount(self, ctx: Context) -> None:
        if ctx.tenant is None or ctx.app is None or ctx.subject_email is None:
            raise RuntimeError("EndUserMounter: tenant/app/subject_email unset — earlier steps did not run")
        end_user = EndUserService.get_or_create_end_user_by_type(
            InvokeFrom.OPENAPI,
            tenant_id=ctx.tenant.id,
            app_id=ctx.app.id,
            user_id=ctx.subject_email,
        )
        _login_as(end_user)
        ctx.caller, ctx.caller_kind = end_user, "end_user"
