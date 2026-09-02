from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.requirements import (
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckSessionOwnership,
    CheckSubject,
    CheckWorkspaceRole,
    Requirement,
    assert_license_valid,
)
from controllers.openapi.auth.subjects import AccountSubject
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
from libs.oauth_bearer import TokenType
from models.account import AccountStatus, TenantAccountRole
from models.oauth import OAuthAccessToken
from services.enterprise.enterprise_service import WebAppAccessMode, WebAppSettings
from services.entities.feature_entities import (
    LicenseStatus,
)

from ._world import (
    ACCOUNT_ID,
    APP_ID,
    CLIENT_ID,
    SESSION_ID,
    TOKEN_ID,
    account_subject,
    make_account,
    make_app,
    make_ctx,
    make_membership,
    make_tenant,
    never_reached,
    persist,
    sso_subject,
    system_features,
    webapp_settings,
)

FEATURES = "controllers.openapi.auth.requirements.FeatureService.get_system_features"
WEBAPP_AUTH = "controllers.openapi.auth.requirements.EnterpriseService.WebAppAuth"
ACCESS_MODE = f"{WEBAPP_AUTH}.get_app_access_mode_by_id"
WEBAPP_PERMISSION = f"{WEBAPP_AUTH}.is_user_allowed_to_access_webapp"
ENFORCE_RBAC = "controllers.openapi.auth.requirements.enforce_rbac_access"
APP_FETCH = "controllers.openapi.auth.loaders.AppService.get_app_by_id"


def test_subject_check_emits_the_wrong_surface_audit(app: Flask, sqlite_session: Session) -> None:
    subject = sso_subject()

    with app.test_request_context("/openapi/v1/account"):
        with patch("controllers.openapi.auth.requirements.emit_wrong_surface") as emit:
            requirement = CheckSubject(allowed=[AccountSubject])
            with pytest.raises(Forbidden, match="unsupported_token_type"):
                requirement.run(subject, make_ctx(sqlite_session, subject=subject), sqlite_session)

    emit.assert_called_once_with(
        subject_type="external_sso",
        attempted_path="/openapi/v1/account",
        client_id=CLIENT_ID,
        token_id=TOKEN_ID,
    )


@pytest.mark.parametrize(
    ("status", "denied"),
    [
        (LicenseStatus.INACTIVE, True),
        (LicenseStatus.EXPIRED, True),
        (LicenseStatus.LOST, True),
        (LicenseStatus.ACTIVE, False),
        (LicenseStatus.NONE, False),
    ],
)
def test_assert_license_valid_denies_only_dead_licences(status: LicenseStatus, denied: bool) -> None:
    with patch(FEATURES, return_value=system_features(license_status=status)):
        if denied:
            with pytest.raises(Forbidden, match="license_invalid"):
                assert_license_valid()
        else:
            assert_license_valid()


def test_assert_license_valid_re_reads_the_licence_on_every_call() -> None:
    """Both callers - the router's endpoint gate and the external-SSO pipeline -
    are process-lifetime, so a memoised verdict would outlive the licence that
    produced it.
    """
    with patch(FEATURES, return_value=system_features(license_status=LicenseStatus.ACTIVE)):
        assert_license_valid()

    with patch(FEATURES, return_value=system_features(license_status=LicenseStatus.EXPIRED)):
        with pytest.raises(Forbidden, match="license_invalid"):
            assert_license_valid()


@pytest.mark.parametrize(
    "requirement",
    [CheckAppApiEnabled(), CheckAppAccess()],
    ids=["api enabled", "webapp access"],
)
def test_an_app_requirement_off_an_app_route_is_a_wiring_bug(
    requirement: Requirement,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    """These are declared per endpoint, so a route with no `app_id` can only
    carry one by mistake. It raises rather than passing quietly: skipping would
    turn a misdeclaration into a check that silently never runs.

    Enterprise, because `CheckAppAccess` answers the edition first and
    would otherwise stand down before reaching the app at all.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(APP_FETCH, never_reached)
    subject = account_subject()

    with pytest.raises(LookupError, match="app_id is not a path parameter"):
        requirement.run(subject, make_ctx(sqlite_session, subject=subject), sqlite_session)


class TestCheckRBACPermission:
    @staticmethod
    def _requirement() -> CheckRBACPermission:
        return CheckRBACPermission(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_VIEW_LAYOUT)

    def test_skips_a_non_account_caller(self, sqlite_session: Session, config_overrides: Callable[..., None]) -> None:
        """No matrix row reaches this: on the routes an SSO token can address,
        RBAC permission either does not apply or no permission is declared, so an SSO caller falling
        into account-scoped RBAC is invisible there.
        """
        config_overrides(RBAC_ENABLED=True)
        subject = sso_subject()

        with patch(ENFORCE_RBAC) as enforce:
            self._requirement().run(subject, make_ctx(sqlite_session, subject=subject, app_id=APP_ID), sqlite_session)

        enforce.assert_not_called()

    @pytest.mark.parametrize("rbac_enabled", [True, False])
    def test_is_inert_wherever_rbac_is_off(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None], rbac_enabled: bool
    ) -> None:
        """No matrix row reaches this: every row runs against a stubbed RBAC
        backend, so a permission that enforced where RBAC is switched off would still
        be admitted there. Standing down is what leaves the `CheckWorkspaceRole`
        beside it as the only arm there.
        """
        config_overrides(RBAC_ENABLED=rbac_enabled)
        persist(sqlite_session, make_app(), make_tenant(), make_account())
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            with patch(ENFORCE_RBAC) as enforce:
                self._requirement().run(subject, ctx, sqlite_session)

        assert enforce.called is rbac_enabled


class TestCheckWorkspaceRole:
    admin_only = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})

    def test_skips_a_non_account_caller(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        """No matrix row reaches this either — and the workspace role check must not even fetch
        the app to decide it.
        """
        monkeypatch.setattr(APP_FETCH, never_reached)
        subject = sso_subject()

        CheckWorkspaceRole(self.admin_only).run(
            subject, make_ctx(sqlite_session, subject=subject, app_id=APP_ID), sqlite_session
        )

    @pytest.mark.parametrize(
        ("status", "role"),
        [
            (AccountStatus.ACTIVE, None),
            (AccountStatus.BANNED, TenantAccountRole.ADMIN),
        ],
        ids=["no membership at all", "banned account still holding a role"],
    )
    def test_the_workspace_role_reads_the_role_through_the_loader(
        self,
        app: Flask,
        sqlite_session: Session,
        config_overrides: Callable[..., None],
        status: AccountStatus,
        role: TenantAccountRole | None,
    ) -> None:
        """Both answers are `load_workspace_role`'s, not a direct role read's: a
        non-member and an account that is not `ACTIVE` are both non-members, and
        both hear 404 rather than the workspace role check's own 403.

        No matrix row reaches this. An `EARLY` membership check pre-empts the
        `NORMAL` workspace role check on every shipped route, and the matrix mints only `ACTIVE`
        accounts — so this is the only thing standing between the workspace role check and a
        refactor that calls `get_account_role_in_tenant` itself, which would
        re-admit a banned admin and answer 403 where the surface answers 404.
        """
        config_overrides(RBAC_ENABLED=False)
        rows: list[object] = [make_app(), make_tenant(), make_account(status=status)]
        if role is not None:
            rows.append(make_membership(role))
        persist(sqlite_session, *rows)
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            with pytest.raises(NotFound, match="workspace not found"):
                CheckWorkspaceRole(self.admin_only).run(subject, ctx, sqlite_session)


class TestCheckAppAccess:
    @pytest.fixture(autouse=True)
    def _enterprise(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)

    def test_no_ops_outside_enterprise(
        self, sqlite_session: Session, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The named guard for the CE contract: the access-mode service is never
        reached at all. Dropping the early return is otherwise only caught
        incidentally, by an unrelated test that happens not to stub it.
        """
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        monkeypatch.setattr(ACCESS_MODE, never_reached)
        persist(sqlite_session, make_app())
        subject = account_subject()

        CheckAppAccess().run(subject, make_ctx(sqlite_session, subject=subject, app_id=APP_ID), sqlite_session)

    @pytest.mark.parametrize(
        ("settings", "failure"),
        [
            (None, None),
            (webapp_settings("a-mode-this-build-has-never-heard-of"), None),
            (None, ValueError("enterprise said no")),
        ],
    )
    def test_rejects_an_access_mode_it_could_not_load(
        self, sqlite_session: Session, settings: WebAppSettings | None, failure: Exception | None
    ) -> None:
        persist(sqlite_session, make_app())
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=system_features(webapp_auth=True)):
            with patch(ACCESS_MODE, return_value=settings, side_effect=failure):
                with pytest.raises(Forbidden, match="app or access mode not loaded"):
                    CheckAppAccess().run(subject, ctx, sqlite_session)

    def test_refuses_a_private_app_when_the_user_cannot_be_resolved(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_app())
        subject = account_subject(account_id=None)
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=system_features(webapp_auth=True)):
            with patch(ACCESS_MODE, return_value=webapp_settings(WebAppAccessMode.PRIVATE.value)):
                with pytest.raises(Forbidden, match="cannot resolve user for private app check"):
                    CheckAppAccess().run(subject, ctx, sqlite_session)

    def test_admits_a_permitted_account_to_a_private_app(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_app())
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=system_features(webapp_auth=True)):
            with patch(ACCESS_MODE, return_value=webapp_settings(WebAppAccessMode.PRIVATE.value)):
                with patch(WEBAPP_PERMISSION, return_value=True) as permitted:
                    CheckAppAccess().run(subject, ctx, sqlite_session)

        permitted.assert_called_once_with(user_id=ACCOUNT_ID, app_id=APP_ID)


class TestCheckSessionOwnership:
    @staticmethod
    def _token(session_id: str, *, account_id: str | None, email: str, issuer: str | None) -> OAuthAccessToken:
        row = OAuthAccessToken(
            token_hash=session_id,
            prefix=TokenType.OAUTH_ACCOUNT.prefix,
            account_id=account_id,
            subject_email=email,
            subject_issuer=issuer,
            client_id=CLIENT_ID,
            device_label="test",
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
        row.id = session_id
        return row

    def test_admits_the_callers_own_session(self, sqlite_session: Session) -> None:
        subject = account_subject()
        persist(
            sqlite_session,
            self._token(SESSION_ID, account_id=ACCOUNT_ID, email="account@example.com", issuer="dify:account"),
        )

        ctx = make_ctx(sqlite_session, subject=subject, session_id=SESSION_ID)
        CheckSessionOwnership().run(subject, ctx, sqlite_session)

    @pytest.mark.parametrize("persist_foreign", [True, False])
    def test_404s_a_session_the_caller_does_not_own(self, sqlite_session: Session, persist_foreign: bool) -> None:
        """A token id owned by another subject is indistinguishable from one that
        does not exist, so session ids cannot be probed across subjects.
        """
        subject = account_subject()
        if persist_foreign:
            persist(
                sqlite_session,
                self._token(SESSION_ID, account_id=str(uuid.uuid4()), email="other@example.com", issuer="dify:account"),
            )

        ctx = make_ctx(sqlite_session, subject=subject, session_id=SESSION_ID)
        with pytest.raises(NotFound, match="session not found"):
            CheckSessionOwnership().run(subject, ctx, sqlite_session)
