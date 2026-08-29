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
from libs.oauth_bearer import Scope, SubjectType
from models import Account, EndUser, TenantAccountJoin
from models.account import TenantAccountRole
from models.enums import EndUserType
from services.enterprise.enterprise_service import WebAppAccessMode

from ._world import (
    ACCOUNT_ID,
    APP_ID,
    CLIENT_ID,
    SSO_EMAIL,
    SSO_ISSUER,
    TENANT_ID,
    TOKEN_ID,
    make_account,
    make_app,
    make_auth,
    make_ctx,
    make_tenant,
    persist,
)


def test_account_subject_carries_its_identity() -> None:
    subject = subject_from_auth(make_auth(SubjectType.ACCOUNT))

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
    subject = subject_from_auth(make_auth(SubjectType.EXTERNAL_SSO))

    assert isinstance(subject, ExternalSsoSubject)
    assert subject.caller_kind is CallerKind.END_USER
    assert subject.webapp_modes == frozenset({WebAppAccessMode.PUBLIC, WebAppAccessMode.SSO_VERIFIED})
    assert subject.external_identity == ExternalIdentity(email=SSO_EMAIL, issuer=SSO_ISSUER)


def test_subject_from_auth_rejects_an_unregistered_subject_type() -> None:
    auth = dataclasses.replace(make_auth(SubjectType.ACCOUNT), subject_type="future_subject")  # type: ignore[arg-type]

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
    subject_type: SubjectType, has_app: bool, expected: bool, sqlite_session: Session
) -> None:
    subject = subject_from_auth(make_auth(subject_type))
    view_args = {"app_id": APP_ID} if has_app else {}

    assert subject.mounts_caller(make_ctx(sqlite_session, subject, **view_args)) is expected


class TestAccountResolveCaller:
    def test_rejects_a_token_whose_account_is_gone(self, sqlite_session: Session) -> None:
        subject = AccountSubject(make_auth(SubjectType.ACCOUNT))

        with pytest.raises(Unauthorized, match="account not found"):
            subject.resolve_caller(make_ctx(sqlite_session, subject), sqlite_session)

    def test_binds_the_current_tenant_to_the_workspace_the_route_resolved(self, sqlite_session: Session) -> None:
        """A loaded workspace is the whole signal. `app_id` in the path says one
        *can* be resolved, never that anything did — and binding on that would
        read a workspace no requirement asked for.
        """
        account = make_account()
        tenant = make_tenant()
        persist(
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
        subject = AccountSubject(make_auth(SubjectType.ACCOUNT))
        ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)
        ctx.set_workspace(tenant)

        caller = subject.resolve_caller(ctx, sqlite_session)

        assert isinstance(caller, Account)
        assert caller.current_tenant_id == TENANT_ID
        assert caller.role == TenantAccountRole.ADMIN

    def test_never_resolves_a_workspace_the_request_did_not_need(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_account())
        subject = AccountSubject(make_auth(SubjectType.ACCOUNT))

        caller = subject.resolve_caller(make_ctx(sqlite_session, subject, app_id=APP_ID), sqlite_session)

        assert isinstance(caller, Account)
        assert caller.current_tenant_id is None


class TestExternalSsoResolveCaller:
    def test_resolves_the_end_user_against_the_apps_workspace(self, sqlite_session: Session) -> None:
        """It loads both itself. Nothing before it on an SSO route needs a
        workspace, so a subject that expected one to be there already would
        resolve an end user against nothing.
        """
        persist(sqlite_session, make_app(), make_tenant())
        subject = ExternalSsoSubject(make_auth(SubjectType.EXTERNAL_SSO))
        ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)
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
        subject = ExternalSsoSubject(make_auth(SubjectType.EXTERNAL_SSO, subject_email=None))
        ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)

        with pytest.raises(Unauthorized, match="missing context for external user resolution"):
            subject.resolve_caller(ctx, sqlite_session)


def test_account_subject_reports_its_own_id_as_the_webapp_user(sqlite_session: Session) -> None:
    assert AccountSubject(make_auth(SubjectType.ACCOUNT)).webapp_user_id(sqlite_session) == ACCOUNT_ID
    assert AccountSubject(make_auth(SubjectType.ACCOUNT, account_id=None)).webapp_user_id(sqlite_session) is None


class TestExternalSsoWebappUserId:
    def test_resolves_the_account_behind_the_sso_email(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_account(email=SSO_EMAIL))
        subject = ExternalSsoSubject(make_auth(SubjectType.EXTERNAL_SSO))

        assert subject.webapp_user_id(sqlite_session) == ACCOUNT_ID

    def test_refuses_to_guess_when_the_email_matches_no_account(self, sqlite_session: Session) -> None:
        assert ExternalSsoSubject(make_auth(SubjectType.EXTERNAL_SSO)).webapp_user_id(sqlite_session) is None

        identityless = ExternalSsoSubject(make_auth(SubjectType.EXTERNAL_SSO, subject_email=None))
        assert identityless.webapp_user_id(sqlite_session) is None
