"""The rows, tokens and subjects the auth-layer tests build their worlds from.

One copy: every module under `auth/` was carrying its own identical `App`,
`Tenant`, `Account` and `AuthContext` builders, so a column added to any of
those models had to be chased through six files.
"""

from __future__ import annotations

import uuid
from typing import NoReturn

from sqlalchemy.orm import Session

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, Subject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, SubjectType, TokenType
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType
from services.enterprise.enterprise_service import WebAppSettings
from services.entities.feature_entities import (
    LicenseStatus,
    LicenseStatusModel,
    SystemFeatureModel,
    WebAppAuthModel,
)

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000003"
TOKEN_ID = "00000000-0000-0000-0000-000000000004"
SESSION_ID = "00000000-0000-0000-0000-000000000005"
OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000006"
CLIENT_ID = "openapi-client"
ACCOUNT_EMAIL = "account@example.com"
SSO_EMAIL = "user@sso.com"
SSO_ISSUER = "https://idp.example"


def make_auth(token_type: TokenType, **overrides: object) -> AuthContext:
    """A live token of either kind. `overrides` names the one field a test varies."""
    is_account = token_type.subject is SubjectType.ACCOUNT
    fields: dict[str, object] = {
        "token_type": token_type,
        "subject_email": None if is_account else SSO_EMAIL,
        "subject_issuer": None if is_account else SSO_ISSUER,
        "account_id": uuid.UUID(ACCOUNT_ID) if is_account else None,
        "client_id": CLIENT_ID,
        "token_id": uuid.UUID(TOKEN_ID),
        "expires_at": None,
    }
    fields.update(overrides)
    return AuthContext(**fields)  # type: ignore[arg-type]


def account_subject(**overrides: object) -> AccountSubject:
    return AccountSubject(make_auth(TokenType.OAUTH_ACCOUNT, **overrides))


def sso_subject(**overrides: object) -> ExternalSsoSubject:
    return ExternalSsoSubject(make_auth(TokenType.OAUTH_EXTERNAL_SSO, **overrides))


def make_app(*, app_id: str = APP_ID, tenant_id: str = TENANT_ID, enable_api: bool = True) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="OpenAPI app",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=enable_api,
        max_active_requests=None,
    )


def make_tenant(*, tenant_id: str = TENANT_ID, status: TenantStatus = TenantStatus.NORMAL) -> Tenant:
    tenant = Tenant(name="OpenAPI tenant", status=status)
    tenant.id = tenant_id
    return tenant


def make_account(*, status: AccountStatus = AccountStatus.ACTIVE, email: str = ACCOUNT_EMAIL) -> Account:
    account = Account(name="OpenAPI account", email=email, status=status)
    account.id = ACCOUNT_ID
    return account


def make_membership(role: TenantAccountRole = TenantAccountRole.NORMAL) -> TenantAccountJoin:
    return TenantAccountJoin(tenant_id=TENANT_ID, account_id=ACCOUNT_ID, current=True, role=role)


def persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


def make_ctx(session: Session, subject: Subject | None = None, **view_args: str) -> Context:
    return Context(subject or account_subject(), session, dict(view_args))


def system_features(
    *,
    license_status: LicenseStatus = LicenseStatus.ACTIVE,
    webapp_auth: bool = False,
) -> SystemFeatureModel:
    return SystemFeatureModel(
        deployment_edition=DeploymentEdition.ENTERPRISE,
        license=LicenseStatusModel(status=license_status),
        webapp_auth=WebAppAuthModel(enabled=webapp_auth),
    )


def webapp_settings(access_mode: str) -> WebAppSettings:
    return WebAppSettings.model_validate({"accessMode": access_mode})


def never_reached(*_args: object, **_kwargs: object) -> NoReturn:
    """Stand-in for anything a test's own setup says the code under test must not reach."""
    raise AssertionError("reached a call this test's setup says nothing should have made")
