from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from controllers.openapi.auth.subjects import (
    AccountSubject,
    ExternalSsoSubject,
    subject_from_auth,
)
from libs.oauth_bearer import TokenType
from models import Account, EndUser, TenantAccountJoin
from models.account import TenantAccountRole
from models.enums import EndUserType

from ._world import (
    ACCOUNT_ID,
    APP_ID,
    SSO_EMAIL,
    TENANT_ID,
    make_account,
    make_app,
    make_auth,
    make_ctx,
    make_tenant,
    persist,
)


@pytest.mark.parametrize(
    ("token_type", "has_app", "expected"),
    [
        (TokenType.OAUTH_ACCOUNT, False, True),
        (TokenType.OAUTH_ACCOUNT, True, True),
        (TokenType.OAUTH_EXTERNAL_SSO, False, False),
        (TokenType.OAUTH_EXTERNAL_SSO, True, True),
    ],
)
def test_mounts_caller_tracks_todays_resolution_points(
    token_type: TokenType, has_app: bool, expected: bool, sqlite_session: Session
) -> None:
    subject = subject_from_auth(make_auth(token_type))
    view_args: dict[str, str] = {"app_id": APP_ID} if has_app else {}

    assert subject.mounts_caller(make_ctx(sqlite_session, subject, **view_args)) is expected


class TestAccountResolveCaller:
    def test_rejects_a_token_whose_account_is_gone(self, sqlite_session: Session) -> None:
        subject = AccountSubject(make_auth(TokenType.OAUTH_ACCOUNT))

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
        subject = AccountSubject(make_auth(TokenType.OAUTH_ACCOUNT))
        ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)
        ctx.workspace = tenant

        caller = subject.resolve_caller(ctx, sqlite_session)

        assert isinstance(caller, Account)
        assert caller.current_tenant_id == TENANT_ID
        assert caller.role == TenantAccountRole.ADMIN

    def test_never_resolves_a_workspace_the_request_did_not_need(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_account())
        subject = AccountSubject(make_auth(TokenType.OAUTH_ACCOUNT))

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
        subject = ExternalSsoSubject(make_auth(TokenType.OAUTH_EXTERNAL_SSO))
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
        subject = ExternalSsoSubject(make_auth(TokenType.OAUTH_EXTERNAL_SSO, subject_email=None))
        ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)

        with pytest.raises(Unauthorized, match="missing context for external user resolution"):
            subject.resolve_caller(ctx, sqlite_session)


class TestExternalSsoWebappUserId:
    def test_resolves_the_account_behind_the_sso_email(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_account(email=SSO_EMAIL))
        subject = ExternalSsoSubject(make_auth(TokenType.OAUTH_EXTERNAL_SSO))

        assert subject.webapp_user_id(sqlite_session) == ACCOUNT_ID

    def test_refuses_to_guess_when_the_email_matches_no_account(self, sqlite_session: Session) -> None:
        assert ExternalSsoSubject(make_auth(TokenType.OAUTH_EXTERNAL_SSO)).webapp_user_id(sqlite_session) is None

        identityless = ExternalSsoSubject(make_auth(TokenType.OAUTH_EXTERNAL_SSO, subject_email=None))
        assert identityless.webapp_user_id(sqlite_session) is None
