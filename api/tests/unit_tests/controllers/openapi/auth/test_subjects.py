from __future__ import annotations

import dataclasses
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.data import CallerKind, ExternalIdentity
from controllers.openapi.auth.subjects import (
    AccountSubject,
    ExternalSsoSubject,
    subject_from_auth,
)
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType
from models import Account, App, EndUser, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus, EndUserType
from models.model import AppMode, IconType
from services.enterprise.enterprise_service import WebAppAccessMode

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000003"
TOKEN_ID = "00000000-0000-0000-0000-000000000004"
CLIENT_ID = "openapi-client"
SSO_EMAIL = "user@sso.com"
SSO_ISSUER = "https://idp.example"


def _auth(subject_type: SubjectType, **overrides: object) -> AuthContext:
    is_account = subject_type is SubjectType.ACCOUNT
    fields: dict[str, object] = {
        "subject_type": subject_type,
        "subject_email": None if is_account else SSO_EMAIL,
        "subject_issuer": None if is_account else SSO_ISSUER,
        "account_id": uuid.UUID(ACCOUNT_ID) if is_account else None,
        "client_id": CLIENT_ID,
        "scopes": subject_type.scopes,
        "token_id": uuid.UUID(TOKEN_ID),
        "token_type": TokenType.OAUTH_ACCOUNT if is_account else TokenType.OAUTH_EXTERNAL_SSO,
        "expires_at": None,
    }
    fields.update(overrides)
    return AuthContext(**fields)  # type: ignore[arg-type]


class _StubContext:
    """Stands in for Task 3's `Context`; `app` / `workspace` blow up when an
    accessor is reached that today's pipeline would not have resolved.
    """

    def __init__(
        self,
        *,
        app: App | None = None,
        workspace: Tenant | None = None,
        has_app: bool = False,
        workspace_resolved: bool = False,
    ) -> None:
        self._app = app
        self._workspace = workspace
        self.has_app = has_app
        self.workspace_resolved = workspace_resolved

    @property
    def app(self) -> App:
        if self._app is None:
            raise AssertionError("app fetched but not available")
        return self._app

    @property
    def workspace(self) -> Tenant:
        if self._workspace is None:
            raise AssertionError("workspace fetched but not available")
        return self._workspace


def _app() -> App:
    return App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="OpenAPI app",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
    )


def _tenant() -> Tenant:
    tenant = Tenant(name="OpenAPI tenant", status=TenantStatus.NORMAL)
    tenant.id = TENANT_ID
    return tenant


def _account(*, email: str = "account@example.com") -> Account:
    account = Account(name="OpenAPI account", email=email, status=AccountStatus.ACTIVE)
    account.id = ACCOUNT_ID
    return account


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


def test_account_subject_carries_its_identity() -> None:
    subject = subject_from_auth(_auth(SubjectType.ACCOUNT))

    assert subject.subject_type is SubjectType.ACCOUNT
    assert subject.caller_kind is CallerKind.ACCOUNT
    assert subject.webapp_modes == frozenset(
        {
            WebAppAccessMode.PUBLIC,
            WebAppAccessMode.SSO_VERIFIED,
            WebAppAccessMode.PRIVATE_ALL,
            WebAppAccessMode.PRIVATE,
        }
    )
    assert subject.account_id == uuid.UUID(ACCOUNT_ID)
    assert subject.token_id == uuid.UUID(TOKEN_ID)
    assert subject.client_id == CLIENT_ID
    assert subject.scopes == frozenset({Scope.FULL})


def test_sso_subject_cannot_reach_private_modes() -> None:
    subject = subject_from_auth(_auth(SubjectType.EXTERNAL_SSO))

    assert isinstance(subject, ExternalSsoSubject)
    assert subject.caller_kind is CallerKind.END_USER
    assert subject.webapp_modes == frozenset({WebAppAccessMode.PUBLIC, WebAppAccessMode.SSO_VERIFIED})
    assert subject.external_identity == ExternalIdentity(email=SSO_EMAIL, issuer=SSO_ISSUER)


def test_subject_from_auth_dispatches_on_subject_type() -> None:
    assert isinstance(subject_from_auth(_auth(SubjectType.ACCOUNT)), AccountSubject)
    assert isinstance(subject_from_auth(_auth(SubjectType.EXTERNAL_SSO)), ExternalSsoSubject)


def test_subject_from_auth_rejects_an_unregistered_subject_type() -> None:
    auth = dataclasses.replace(_auth(SubjectType.ACCOUNT), subject_type="future_subject")  # type: ignore[arg-type]

    with pytest.raises(Forbidden, match="unsupported_token_type"):
        subject_from_auth(auth)


@pytest.mark.parametrize(
    ("subject_type", "has_app", "expected"),
    [
        (SubjectType.ACCOUNT, False, True),
        (SubjectType.ACCOUNT, True, True),
        (SubjectType.EXTERNAL_SSO, False, False),
        (SubjectType.EXTERNAL_SSO, True, True),
    ],
)
def test_mounts_caller_tracks_todays_resolution_points(
    subject_type: SubjectType, has_app: bool, expected: bool
) -> None:
    subject = subject_from_auth(_auth(subject_type))

    assert subject.mounts_caller(_StubContext(has_app=has_app)) is expected


class TestAccountResolveCaller:
    def test_rejects_a_token_whose_account_is_gone(self, sqlite_session: Session) -> None:
        subject = AccountSubject(_auth(SubjectType.ACCOUNT))

        with pytest.raises(Unauthorized, match="account not found"):
            subject.resolve_caller(_StubContext(), sqlite_session)

    @pytest.mark.parametrize(("has_app", "workspace_resolved"), [(True, False), (False, True)])
    def test_binds_the_current_tenant_on_app_scoped_and_membership_routes(
        self, sqlite_session: Session, has_app: bool, workspace_resolved: bool
    ) -> None:
        account = _account()
        tenant = _tenant()
        _persist(
            sqlite_session,
            account,
            tenant,
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                current=True,
                role=TenantAccountRole.ADMIN,
            ),
        )
        subject = AccountSubject(_auth(SubjectType.ACCOUNT))
        ctx = _StubContext(workspace=tenant, has_app=has_app, workspace_resolved=workspace_resolved)

        caller = subject.resolve_caller(ctx, sqlite_session)

        assert isinstance(caller, Account)
        assert caller.current_tenant_id == TENANT_ID
        assert caller.role == TenantAccountRole.ADMIN

    def test_never_resolves_a_workspace_the_request_did_not_need(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _account())
        subject = AccountSubject(_auth(SubjectType.ACCOUNT))

        caller = subject.resolve_caller(_StubContext(), sqlite_session)

        assert isinstance(caller, Account)
        assert caller.current_tenant_id is None


class TestExternalSsoResolveCaller:
    def test_resolves_the_end_user_against_the_apps_workspace(self, sqlite_session: Session) -> None:
        subject = ExternalSsoSubject(_auth(SubjectType.EXTERNAL_SSO))
        ctx = _StubContext(app=_app(), workspace=_tenant())
        end_user = EndUser(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            type=EndUserType.OPENAPI,
            is_anonymous=False,
            session_id=SSO_EMAIL,
        )

        with patch(
            "controllers.openapi.auth.subjects.EndUserService.get_or_create_end_user_by_type",
            return_value=end_user,
        ) as get_or_create:
            assert subject.resolve_caller(ctx, sqlite_session) is end_user

        get_or_create.assert_called_once_with(
            EndUserType.OPENAPI,
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            user_id=SSO_EMAIL,
        )

    def test_rejects_a_token_without_an_external_identity(self, sqlite_session: Session) -> None:
        subject = ExternalSsoSubject(_auth(SubjectType.EXTERNAL_SSO, subject_email=None))
        ctx = _StubContext(app=_app(), workspace=_tenant())

        with pytest.raises(Unauthorized, match="missing context for external user resolution"):
            subject.resolve_caller(ctx, sqlite_session)


def test_account_subject_reports_its_own_id_as_the_webapp_user(sqlite_session: Session) -> None:
    assert AccountSubject(_auth(SubjectType.ACCOUNT)).webapp_user_id(sqlite_session) == ACCOUNT_ID
    assert AccountSubject(_auth(SubjectType.ACCOUNT, account_id=None)).webapp_user_id(sqlite_session) is None


class TestExternalSsoWebappUserId:
    def test_resolves_the_account_behind_the_sso_email(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _account(email=SSO_EMAIL))
        subject = ExternalSsoSubject(_auth(SubjectType.EXTERNAL_SSO))

        assert subject.webapp_user_id(sqlite_session) == ACCOUNT_ID

    def test_refuses_to_guess_when_the_email_matches_no_account(self, sqlite_session: Session) -> None:
        assert ExternalSsoSubject(_auth(SubjectType.EXTERNAL_SSO)).webapp_user_id(sqlite_session) is None

        identityless = ExternalSsoSubject(_auth(SubjectType.EXTERNAL_SSO, subject_email=None))
        assert identityless.webapp_user_id(sqlite_session) is None
