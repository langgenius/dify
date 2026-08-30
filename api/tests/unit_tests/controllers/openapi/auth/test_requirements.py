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
    CheckAppApiEnabled,
    CheckSessionOwnership,
    Rank,
    RBACScene,
    Requirement,
    RequireWebappAccess,
    RequireWorkspaceMembership,
    RoleFloor,
    SubjectCheck,
    assert_license_valid,
)
from controllers.openapi.auth.subjects import AccountSubject
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
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
    SSO_EMAIL,
    TENANT_ID,
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


def test_membership_runs_before_permission() -> None:
    """The executable form of the 404-before-403 rule: a non-member must be
    refused before RBAC can confirm the workspace exists. `EARLY < NORMAL` makes
    it structural, independent of any call site's declared order — which is what
    lets every route declare its own membership check without also having to
    order it against the permission checks beside it.
    """
    assert SubjectCheck.rank < RequireWorkspaceMembership.rank < RBACScene.rank
    assert RequireWorkspaceMembership.rank is Rank.EARLY
    assert RoleFloor.rank is RBACScene.rank


def test_subject_check_emits_the_wrong_surface_audit(app: Flask, sqlite_session: Session) -> None:
    subject = sso_subject()

    with app.test_request_context("/openapi/v1/account"):
        with patch("controllers.openapi.auth.requirements.emit_wrong_surface") as emit:
            requirement = SubjectCheck(allowed=[AccountSubject])
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
    [CheckAppApiEnabled(), RequireWebappAccess()],
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

    Enterprise, because `RequireWebappAccess` answers the edition first and
    would otherwise stand down before reaching the app at all.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(APP_FETCH, never_reached)
    subject = account_subject()

    with pytest.raises(LookupError, match="app_id is not a path parameter"):
        requirement.run(subject, make_ctx(sqlite_session, subject=subject), sqlite_session)


class TestMembership:
    def test_skips_a_non_account_caller(self, sqlite_session: Session) -> None:
        subject = sso_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        RequireWorkspaceMembership().run(subject, ctx, sqlite_session)


class TestRBACScene:
    admin_only = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})

    @staticmethod
    def _requirement() -> RBACScene:
        return RBACScene(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_VIEW_LAYOUT)

    def test_skips_a_non_account_caller(self, sqlite_session: Session, config_overrides: Callable[..., None]) -> None:
        config_overrides(RBAC_ENABLED=True)
        subject = sso_subject()

        with patch(ENFORCE_RBAC) as enforce:
            self._requirement().run(subject, make_ctx(sqlite_session, subject=subject, app_id=APP_ID), sqlite_session)

        enforce.assert_not_called()

    def test_the_role_floor_beside_it_gives_way(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """The two run as a route declares them, scene first. A member below the
        legacy floor still reaches the RBAC check, and the floor that names this
        scene stands down instead of denying behind it.
        """
        config_overrides(RBAC_ENABLED=True)
        persist(sqlite_session, make_app(), make_tenant(), make_account(), make_membership(TenantAccountRole.NORMAL))
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)
        floor = RoleFloor(self.admin_only, superseded_by=RBACPermission.APP_VIEW_LAYOUT)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            with patch(ENFORCE_RBAC) as enforce:
                self._requirement().run(subject, ctx, sqlite_session)
                floor.run(subject, ctx, sqlite_session)

        enforce.assert_called_once_with(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT_ID,
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_VIEW_LAYOUT,
            resource_required=True,
            path_args={"app_id": APP_ID},
        )

    @pytest.mark.parametrize("rbac_enabled", [True, False])
    def test_is_inert_wherever_rbac_is_off(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None], rbac_enabled: bool
    ) -> None:
        """Standing down there is what lets a `RoleFloor` beside it take over,
        and it has to be inert without loading anything — an account with no
        membership at all still passes.
        """
        config_overrides(RBAC_ENABLED=rbac_enabled)
        persist(sqlite_session, make_app(), make_tenant(), make_account())
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            with patch(ENFORCE_RBAC) as enforce:
                self._requirement().run(subject, ctx, sqlite_session)

        assert enforce.called is rbac_enabled


class TestRoleFloor:
    admin_only = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})

    def test_a_floor_naming_no_scene_survives_rbac(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """`workspaces.py`'s member-management routes declare a floor and no
        scene: nothing has taken the job over, so the stand-down never fires for
        them and an RBAC deployment keeps the guard.
        """
        config_overrides(RBAC_ENABLED=True)
        persist(sqlite_session, make_tenant(), make_account(), make_membership(TenantAccountRole.NORMAL))
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, workspace_id=TENANT_ID)

        with app.test_request_context(f"/openapi/v1/workspaces/{TENANT_ID}/members"):
            with pytest.raises(Forbidden, match="insufficient workspace role"):
                RoleFloor(self.admin_only).run(subject, ctx, sqlite_session)

    def test_skips_a_non_account_caller(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(APP_FETCH, never_reached)
        subject = sso_subject()

        RoleFloor(self.admin_only).run(
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
    def test_the_role_floor_reads_the_role_through_the_loader(
        self,
        app: Flask,
        sqlite_session: Session,
        config_overrides: Callable[..., None],
        status: AccountStatus,
        role: TenantAccountRole | None,
    ) -> None:
        """Both answers are `load_workspace_role`'s, not a direct role read's: a
        non-member and an account that is not `ACTIVE` are both non-members, and
        both hear 404 rather than the floor's own 403.

        No matrix row reaches this. An `EARLY` membership requirement pre-empts the
        `NORMAL` floor on every shipped route, and the matrix mints only `ACTIVE`
        accounts — so this is the only thing standing between the floor and a
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
                RoleFloor(self.admin_only).run(subject, ctx, sqlite_session)


class TestRequireWebappAccess:
    @pytest.fixture(autouse=True)
    def _enterprise(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)

    def test_no_ops_outside_enterprise(
        self, sqlite_session: Session, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        monkeypatch.setattr(ACCESS_MODE, never_reached)
        persist(sqlite_session, make_app())
        subject = account_subject()

        RequireWebappAccess().run(subject, make_ctx(sqlite_session, subject=subject, app_id=APP_ID), sqlite_session)

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
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

    def test_the_acl_is_gated_on_webapp_auth_but_the_private_check_is_not(self, sqlite_session: Session) -> None:
        """Collapsing the two into one `webapp_auth.enabled` gate would let any
        SSO caller into a private app.
        """
        persist(sqlite_session, make_app(), make_account(email=SSO_EMAIL))
        subject = sso_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=system_features(webapp_auth=False)):
            with patch(ACCESS_MODE, return_value=webapp_settings(WebAppAccessMode.PRIVATE.value)):
                with patch(WEBAPP_PERMISSION, return_value=True):
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

                with patch(WEBAPP_PERMISSION, return_value=False):
                    with pytest.raises(Forbidden, match="user_not_allowed_for_private_app"):
                        RequireWebappAccess().run(subject, ctx, sqlite_session)

    def test_refuses_a_private_app_when_the_user_cannot_be_resolved(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_app())
        subject = account_subject(account_id=None)
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=system_features(webapp_auth=True)):
            with patch(ACCESS_MODE, return_value=webapp_settings(WebAppAccessMode.PRIVATE.value)):
                with pytest.raises(Forbidden, match="cannot resolve user for private app check"):
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

    def test_admits_a_permitted_account_to_a_private_app(self, sqlite_session: Session) -> None:
        persist(sqlite_session, make_app())
        subject = account_subject()
        ctx = make_ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=system_features(webapp_auth=True)):
            with patch(ACCESS_MODE, return_value=webapp_settings(WebAppAccessMode.PRIVATE.value)):
                with patch(WEBAPP_PERMISSION, return_value=True) as permitted:
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

        permitted.assert_called_once_with(user_id=ACCOUNT_ID, app_id=APP_ID)


class TestCheckSessionOwnership:
    @staticmethod
    def _token(session_id: str, *, account_id: str | None, email: str, issuer: str | None) -> OAuthAccessToken:
        row = OAuthAccessToken(
            token_hash=session_id,
            prefix="dfoa_",
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
