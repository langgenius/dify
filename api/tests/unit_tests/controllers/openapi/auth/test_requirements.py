from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import NoReturn
from unittest.mock import patch

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_caller
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckAppWorkspaceMembership,
    CheckSessionOwnership,
    EditionCheck,
    LicenseCheck,
    Rank,
    RBACCheck,
    Requirement,
    RequireWebappAccess,
    RequireWorkspaceMembership,
    SubjectCheck,
    TokenScope,
)
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, Subject
from controllers.openapi.human_input_form import CheckFormSurface
from core.rbac import RBACPermission, RBACResourceScope
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType
from models.oauth import OAuthAccessToken
from services.account_service import TenantService
from services.enterprise.enterprise_service import WebAppAccessMode, WebAppSettings
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
CLIENT_ID = "openapi-client"
SSO_EMAIL = "user@sso.com"

FEATURES = "controllers.openapi.auth.requirements.FeatureService.get_system_features"
WEBAPP_AUTH = "controllers.openapi.auth.requirements.EnterpriseService.WebAppAuth"
ACCESS_MODE = f"{WEBAPP_AUTH}.get_app_access_mode_by_id"
WEBAPP_PERMISSION = f"{WEBAPP_AUTH}.is_user_allowed_to_access_webapp"
ENFORCE_RBAC = "controllers.openapi.auth.requirements.enforce_rbac_access"
APP_FETCH = "controllers.openapi.auth.loaders.AppService.get_app_by_id"


def _auth(subject_type: SubjectType, **overrides: object) -> AuthContext:
    is_account = subject_type is SubjectType.ACCOUNT
    fields: dict[str, object] = {
        "subject_type": subject_type,
        "subject_email": None if is_account else SSO_EMAIL,
        "subject_issuer": None if is_account else "https://idp.example",
        "account_id": uuid.UUID(ACCOUNT_ID) if is_account else None,
        "client_id": CLIENT_ID,
        "scopes": subject_type.scopes,
        "token_id": uuid.UUID(TOKEN_ID),
        "token_type": TokenType.OAUTH_ACCOUNT if is_account else TokenType.OAUTH_EXTERNAL_SSO,
        "expires_at": None,
    }
    fields.update(overrides)
    return AuthContext(**fields)  # type: ignore[arg-type]


def _account_subject(**overrides: object) -> AccountSubject:
    return AccountSubject(_auth(SubjectType.ACCOUNT, **overrides))


def _sso_subject(**overrides: object) -> ExternalSsoSubject:
    return ExternalSsoSubject(_auth(SubjectType.EXTERNAL_SSO, **overrides))


def _app(*, enable_api: bool = True) -> App:
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
        enable_api=enable_api,
        max_active_requests=None,
    )


def _tenant() -> Tenant:
    tenant = Tenant(name="OpenAPI tenant", status=TenantStatus.NORMAL)
    tenant.id = TENANT_ID
    return tenant


def _account(*, status: AccountStatus = AccountStatus.ACTIVE, email: str = "account@example.com") -> Account:
    account = Account(name="OpenAPI account", email=email, status=status)
    account.id = ACCOUNT_ID
    return account


def _membership(role: TenantAccountRole = TenantAccountRole.NORMAL) -> TenantAccountJoin:
    return TenantAccountJoin(tenant_id=TENANT_ID, account_id=ACCOUNT_ID, current=True, role=role)


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


def _ctx(session: Session, *, subject: Subject | None = None, **view_args: str) -> Context:
    return Context(subject or _account_subject(), session, dict(view_args))


def _features(
    *,
    license_status: LicenseStatus = LicenseStatus.ACTIVE,
    webapp_auth_enabled: bool = False,
) -> SystemFeatureModel:
    return SystemFeatureModel(
        deployment_edition=DeploymentEdition.ENTERPRISE,
        license=LicenseStatusModel(status=license_status),
        webapp_auth=WebAppAuthModel(enabled=webapp_auth_enabled),
    )


def _settings(access_mode: str) -> WebAppSettings:
    return WebAppSettings.model_validate({"accessMode": access_mode})


def _boom(*_args: object, **_kwargs: object) -> NoReturn:
    raise AssertionError("reached a service the requirement should not have called")


@pytest.mark.parametrize(
    ("requirement", "subject", "message"),
    [
        (TokenScope(Scope.APPS_RUN), _account_subject(scopes=frozenset({Scope.APPS_RUN})), None),
        (TokenScope(Scope.APPS_RUN), _account_subject(scopes=frozenset({Scope.FULL})), None),
        (TokenScope(Scope.APPS_RUN), _account_subject(scopes=frozenset()), "insufficient_scope"),
        (SubjectCheck(allowed=[AccountSubject]), _account_subject(), None),
        (SubjectCheck(allowed=[AccountSubject]), _sso_subject(), "unsupported_token_type"),
        (SubjectCheck(allowed=[AccountSubject, ExternalSsoSubject]), _sso_subject(), None),
        (EditionCheck(frozenset({DeploymentEdition.COMMUNITY})), _account_subject(), None),
        (EditionCheck(frozenset({DeploymentEdition.ENTERPRISE})), _sso_subject(), "external_sso_requires_ee"),
    ],
)
def test_subject_only_requirement_outcomes(
    requirement: Requirement,
    subject: Subject,
    message: str | None,
    app: Flask,
    sqlite_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    ctx = _ctx(sqlite_session, subject=subject)

    with app.test_request_context("/openapi/v1/apps"):
        if message is None:
            requirement.run(subject, ctx, sqlite_session)
        else:
            with pytest.raises(Forbidden, match=message):
                requirement.run(subject, ctx, sqlite_session)


def test_membership_runs_before_permission() -> None:
    """The executable form of the 404-before-403 rule: a non-member must be
    refused before RBAC can confirm the workspace exists. `EARLY < NORMAL`
    makes it structural, independent of any call site's declared order.
    """
    assert SubjectCheck.rank < CheckAppWorkspaceMembership.rank < RBACCheck.rank


def test_both_membership_requirements_decide_the_same_thing() -> None:
    assert RequireWorkspaceMembership.rank == CheckAppWorkspaceMembership.rank == Rank.EARLY


def _shipped_requirements() -> frozenset[type[Requirement]]:
    """Every `Requirement` the app can put in a pipeline, walked off the class
    tree rather than listed.

    Recursive, so an intermediate base cannot hide a subclass, and narrowed to
    `controllers.` so the test doubles in `test_pipelines.py` — which are
    `Requirement` subclasses too, and present or absent depending on what else
    the session imported — cannot pad or destabilise the set.
    """
    found: set[type[Requirement]] = set()
    pending = list(Requirement.__subclasses__())
    while pending:
        requirement = pending.pop()
        if requirement in found:
            continue
        found.add(requirement)
        pending.extend(requirement.__subclasses__())
    return frozenset(cls for cls in found if cls.__module__.startswith("controllers."))


def test_requirement_default_rank_is_normal() -> None:
    """The definitional guard on the base class's default. What that default
    means for sort order is pinned positionally by `test_pipelines.py`'s
    ordering tests, not here.
    """
    assert Requirement.rank is Rank.NORMAL


def test_every_requirement_has_a_valid_rank() -> None:
    """Derived, not listed — a hand-written list is exactly what a new requirement
    would not be added to.
    """
    shipped = _shipped_requirements()
    # Importing `CheckFormSurface` loads the `controllers.openapi` package, and its
    # `__init__` imports every route module — so requirements a feature declares
    # beside itself are in the walk, not just the ones in `auth/requirements.py`.
    assert CheckFormSurface in shipped
    for requirement in shipped:
        assert isinstance(requirement.rank, Rank), f"{requirement.__name__}'s rank is not a Rank"


def test_subject_check_emits_the_wrong_surface_audit(app: Flask, sqlite_session: Session) -> None:
    subject = _sso_subject()

    with app.test_request_context("/openapi/v1/account"):
        with patch("controllers.openapi.auth.requirements.emit_wrong_surface") as emit:
            requirement = SubjectCheck(allowed=[AccountSubject])
            with pytest.raises(Forbidden, match="unsupported_token_type"):
                requirement.run(subject, _ctx(sqlite_session, subject=subject), sqlite_session)

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
def test_license_check_denies_only_dead_licences(status: LicenseStatus, denied: bool, sqlite_session: Session) -> None:
    subject = _account_subject()

    with patch(FEATURES, return_value=_features(license_status=status)):
        if denied:
            with pytest.raises(Forbidden, match="license_invalid"):
                LicenseCheck().run(subject, _ctx(sqlite_session), sqlite_session)
        else:
            LicenseCheck().run(subject, _ctx(sqlite_session), sqlite_session)


def test_license_check_re_reads_the_licence_on_every_run(sqlite_session: Session) -> None:
    """A requirement is a process-lifetime singleton, so a memoised verdict
    would outlive the licence that produced it.
    """
    requirement = LicenseCheck()
    subject = _account_subject()

    with patch(FEATURES, return_value=_features(license_status=LicenseStatus.ACTIVE)):
        requirement.run(subject, _ctx(sqlite_session), sqlite_session)

    with patch(FEATURES, return_value=_features(license_status=LicenseStatus.EXPIRED)):
        with pytest.raises(Forbidden, match="license_invalid"):
            requirement.run(subject, _ctx(sqlite_session), sqlite_session)


class TestCheckAppApiEnabled:
    @pytest.mark.parametrize(("enable_api", "denied"), [(True, False), (False, True)])
    def test_denies_only_when_the_app_has_the_api_off(
        self, sqlite_session: Session, enable_api: bool, denied: bool
    ) -> None:
        _persist(sqlite_session, _app(enable_api=enable_api))
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        if denied:
            with pytest.raises(Forbidden, match="service_api_disabled"):
                CheckAppApiEnabled().run(subject, ctx, sqlite_session)
        else:
            CheckAppApiEnabled().run(subject, ctx, sqlite_session)

    def test_no_ops_on_a_route_without_an_app_id(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(APP_FETCH, _boom)
        subject = _account_subject()

        CheckAppApiEnabled().run(subject, _ctx(sqlite_session, subject=subject), sqlite_session)


class TestMembership:
    def test_app_scoped_membership_404s_a_non_member(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app(), _tenant(), _account())
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with pytest.raises(NotFound, match="workspace not found"):
            CheckAppWorkspaceMembership().run(subject, ctx, sqlite_session)

    def test_404s_an_inactive_account_that_still_holds_a_role(self, sqlite_session: Session) -> None:
        """`load_workspace_role` treats a non-active caller as a non-member,
        which is a 404 here.
        """
        _persist(
            sqlite_session,
            _app(),
            _tenant(),
            _account(status=AccountStatus.BANNED),
            _membership(TenantAccountRole.ADMIN),
        )
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with pytest.raises(NotFound, match="workspace not found"):
            CheckAppWorkspaceMembership().run(subject, ctx, sqlite_session)

    def test_app_scoped_membership_no_ops_without_an_app_id(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The fixed requirement runs on every account route, including the
        four that carry no `app_id`.
        """
        monkeypatch.setattr(APP_FETCH, _boom)
        subject = _account_subject()

        CheckAppWorkspaceMembership().run(subject, _ctx(sqlite_session, subject=subject), sqlite_session)

    def test_skips_a_non_account_caller(self, sqlite_session: Session) -> None:
        subject = _sso_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        RequireWorkspaceMembership().run(subject, ctx, sqlite_session)

    def test_declared_membership_runs_on_a_route_with_no_path_params(self, app: Flask, sqlite_session: Session) -> None:
        """`GET /apps` takes its workspace from the query string, so membership
        cannot be inferred from `view_args`.
        """
        _persist(sqlite_session, _tenant(), _account())
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject)

        with app.test_request_context(f"/openapi/v1/apps?workspace_id={TENANT_ID}"):
            with pytest.raises(NotFound, match="workspace not found"):
                RequireWorkspaceMembership().run(subject, ctx, sqlite_session)

    def test_resolves_the_workspace_before_the_caller(self, app: Flask, sqlite_session: Session) -> None:
        """Reading `ctx.caller` first would leave the account mounted with no
        current tenant — silently, without an exception.
        """
        _persist(sqlite_session, _tenant(), _account(), _membership(TenantAccountRole.ADMIN))
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject)

        with app.test_request_context(f"/openapi/v1/apps?workspace_id={TENANT_ID}"):
            RequireWorkspaceMembership().run(subject, ctx, sqlite_session)

        caller = load_caller(ctx)
        assert isinstance(caller, Account)
        assert caller.current_tenant_id == TENANT_ID

    def test_membership_and_the_role_floor_share_one_membership_read(
        self,
        app: Flask,
        sqlite_session: Session,
        config_overrides: Callable[..., None],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Both requirements run on a role-gated route. Storing the role on
        `Context` is what keeps that one SELECT rather than two.
        """
        config_overrides(RBAC_ENABLED=False)
        _persist(sqlite_session, _app(), _tenant(), _account(), _membership(TenantAccountRole.ADMIN))
        calls: list[int] = []

        def _counted(*_args: object, **_kwargs: object) -> TenantAccountRole:
            calls.append(1)
            return TenantAccountRole.ADMIN

        monkeypatch.setattr(TenantService, "get_account_role_in_tenant", _counted)
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)
        floor = RBACCheck(
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_VIEW_LAYOUT,
            roles=frozenset({TenantAccountRole.ADMIN}),
        )

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            CheckAppWorkspaceMembership().run(subject, ctx, sqlite_session)
            floor.run(subject, ctx, sqlite_session)

        assert len(calls) == 1


class TestRBACCheck:
    admin_only = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN})

    @staticmethod
    def _requirement(*, roles: frozenset[TenantAccountRole] | None) -> RBACCheck:
        return RBACCheck(
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_VIEW_LAYOUT,
            roles=roles,
        )

    def test_skips_a_non_account_caller(self, sqlite_session: Session, config_overrides: Callable[..., None]) -> None:
        config_overrides(RBAC_ENABLED=True)
        subject = _sso_subject()

        with patch(ENFORCE_RBAC) as enforce:
            self._requirement(roles=self.admin_only).run(
                subject, _ctx(sqlite_session, subject=subject, app_id=APP_ID), sqlite_session
            )

        enforce.assert_not_called()

    def test_the_role_floor_gives_way_to_rbac(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """The role floor deliberately stands down when RBAC is on, so a member
        below the legacy floor must still reach the RBAC check.
        """
        config_overrides(RBAC_ENABLED=True)
        _persist(sqlite_session, _app(), _tenant(), _account(), _membership(TenantAccountRole.NORMAL))
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            with patch(ENFORCE_RBAC) as enforce:
                self._requirement(roles=self.admin_only).run(subject, ctx, sqlite_session)

        enforce.assert_called_once_with(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT_ID,
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_VIEW_LAYOUT,
            resource_required=True,
            path_args={},
        )

    @pytest.mark.parametrize(
        ("role", "expected", "message"),
        [
            (TenantAccountRole.ADMIN, None, ""),
            (TenantAccountRole.NORMAL, Forbidden, "insufficient workspace role"),
            (None, NotFound, "workspace not found"),
        ],
    )
    def test_the_role_floor_applies_when_rbac_is_off(
        self,
        app: Flask,
        sqlite_session: Session,
        config_overrides: Callable[..., None],
        role: TenantAccountRole | None,
        expected: type[Exception] | None,
        message: str,
    ) -> None:
        config_overrides(RBAC_ENABLED=False)
        rows: list[object] = [_app(), _tenant(), _account()]
        if role is not None:
            rows.append(_membership(role))
        _persist(sqlite_session, *rows)
        subject = _account_subject()
        requirement = self._requirement(roles=self.admin_only)
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            if expected is None:
                requirement.run(subject, ctx, sqlite_session)
            else:
                with pytest.raises(expected, match=message):
                    requirement.run(subject, ctx, sqlite_session)

    def test_a_scene_less_declaration_keeps_enforcing_the_role_floor(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """`workspaces.py`'s member-management routes declare a role floor and no
        scene, so the stand-down never fires for them.
        """
        config_overrides(RBAC_ENABLED=True)
        _persist(sqlite_session, _tenant(), _account(), _membership(TenantAccountRole.NORMAL))
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, workspace_id=TENANT_ID)

        with app.test_request_context(f"/openapi/v1/workspaces/{TENANT_ID}/members"):
            with patch(ENFORCE_RBAC) as enforce:
                with pytest.raises(Forbidden, match="insufficient workspace role"):
                    RBACCheck(roles=self.admin_only).run(subject, ctx, sqlite_session)

        enforce.assert_not_called()

    @pytest.mark.parametrize("rbac_enabled", [True, False])
    def test_a_scene_only_declaration_never_touches_the_role_floor(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None], rbac_enabled: bool
    ) -> None:
        """The shape seven of the eleven sites use. With RBAC off the whole
        requirement is a no-op, even for an account with no membership at all.
        """
        config_overrides(RBAC_ENABLED=rbac_enabled)
        _persist(sqlite_session, _app(), _tenant(), _account())
        subject = _account_subject()
        requirement = self._requirement(roles=None)
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            with patch(ENFORCE_RBAC) as enforce:
                requirement.run(subject, ctx, sqlite_session)

        assert enforce.called is rbac_enabled

    def test_the_role_floor_404s_an_inactive_account_that_still_holds_a_role(
        self, app: Flask, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """`load_workspace_role` treats a non-active caller as a non-member,
        so the floor 404s a banned admin whether or not a membership requirement
        ran first on this request.
        """
        config_overrides(RBAC_ENABLED=False)
        _persist(
            sqlite_session,
            _app(),
            _tenant(),
            _account(status=AccountStatus.BANNED),
            _membership(TenantAccountRole.ADMIN),
        )
        subject = _account_subject()
        requirement = self._requirement(roles=self.admin_only)
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with app.test_request_context(f"/openapi/v1/apps/{APP_ID}"):
            with pytest.raises(NotFound, match="workspace not found"):
                requirement.run(subject, ctx, sqlite_session)

    @pytest.mark.parametrize("resource_type", [None, RBACResourceScope.APP])
    def test_rejects_a_declaration_that_checks_nothing(self, resource_type: RBACResourceScope | None) -> None:
        with pytest.raises(ValueError):
            RBACCheck(resource_type=resource_type)


class TestRequireWebappAccess:
    @pytest.fixture(autouse=True)
    def _enterprise(self, config_overrides: Callable[..., None]) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)

    def test_no_ops_outside_enterprise(
        self, sqlite_session: Session, config_overrides: Callable[..., None], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        monkeypatch.setattr(ACCESS_MODE, _boom)
        _persist(sqlite_session, _app())
        subject = _account_subject()

        RequireWebappAccess().run(subject, _ctx(sqlite_session, subject=subject, app_id=APP_ID), sqlite_session)

    def test_no_ops_on_a_route_without_an_app_id(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`/permitted-external-apps` declares this requirement alongside
        `/permitted-external-apps/<app_id>` and carries no `app_id`.
        """
        monkeypatch.setattr(APP_FETCH, _boom)
        monkeypatch.setattr(ACCESS_MODE, _boom)
        subject = _account_subject()

        RequireWebappAccess().run(subject, _ctx(sqlite_session, subject=subject), sqlite_session)

    def test_rejects_a_mode_the_subject_cannot_reach(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app())
        subject = _sso_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=_features(webapp_auth_enabled=True)):
            with patch(ACCESS_MODE, return_value=_settings(WebAppAccessMode.PRIVATE_ALL.value)):
                with pytest.raises(Forbidden, match="subject_not_allowed_for_access_mode"):
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

    @pytest.mark.parametrize(
        ("settings", "failure"),
        [
            (None, None),
            (_settings("a-mode-this-build-has-never-heard-of"), None),
            (None, ValueError("enterprise said no")),
        ],
    )
    def test_rejects_an_access_mode_it_could_not_load(
        self, sqlite_session: Session, settings: WebAppSettings | None, failure: Exception | None
    ) -> None:
        _persist(sqlite_session, _app())
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=_features(webapp_auth_enabled=True)):
            with patch(ACCESS_MODE, return_value=settings, side_effect=failure):
                with pytest.raises(Forbidden, match="app or access mode not loaded"):
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

    def test_the_acl_is_gated_on_webapp_auth_but_the_private_check_is_not(self, sqlite_session: Session) -> None:
        """Collapsing the two into one `webapp_auth.enabled` gate would let any
        SSO caller into a private app.
        """
        _persist(sqlite_session, _app(), _account(email=SSO_EMAIL))
        subject = _sso_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=_features(webapp_auth_enabled=False)):
            with patch(ACCESS_MODE, return_value=_settings(WebAppAccessMode.PRIVATE.value)):
                with patch(WEBAPP_PERMISSION, return_value=True):
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

                with patch(WEBAPP_PERMISSION, return_value=False):
                    with pytest.raises(Forbidden, match="user_not_allowed_for_private_app"):
                        RequireWebappAccess().run(subject, ctx, sqlite_session)

    def test_refuses_a_private_app_when_the_user_cannot_be_resolved(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app())
        subject = _account_subject(account_id=None)
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=_features(webapp_auth_enabled=True)):
            with patch(ACCESS_MODE, return_value=_settings(WebAppAccessMode.PRIVATE.value)):
                with pytest.raises(Forbidden, match="cannot resolve user for private app check"):
                    RequireWebappAccess().run(subject, ctx, sqlite_session)

    def test_admits_a_permitted_account_to_a_private_app(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app())
        subject = _account_subject()
        ctx = _ctx(sqlite_session, subject=subject, app_id=APP_ID)

        with patch(FEATURES, return_value=_features(webapp_auth_enabled=True)):
            with patch(ACCESS_MODE, return_value=_settings(WebAppAccessMode.PRIVATE.value)):
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

    def test_admits_the_callers_own_session(self, app: Flask, sqlite_session: Session) -> None:
        subject = _account_subject()
        _persist(
            sqlite_session,
            self._token(SESSION_ID, account_id=ACCOUNT_ID, email="account@example.com", issuer="dify:account"),
        )

        with app.test_request_context(f"/openapi/v1/account/sessions/{SESSION_ID}", method="DELETE"):
            request.view_args = {"session_id": SESSION_ID}
            CheckSessionOwnership().run(subject, _ctx(sqlite_session, subject=subject), sqlite_session)

    @pytest.mark.parametrize("persist_foreign", [True, False])
    def test_404s_a_session_the_caller_does_not_own(
        self, app: Flask, sqlite_session: Session, persist_foreign: bool
    ) -> None:
        """A token id owned by another subject is indistinguishable from one that
        does not exist, so session ids cannot be probed across subjects.
        """
        subject = _account_subject()
        if persist_foreign:
            _persist(
                sqlite_session,
                self._token(SESSION_ID, account_id=str(uuid.uuid4()), email="other@example.com", issuer="dify:account"),
            )

        with app.test_request_context(f"/openapi/v1/account/sessions/{SESSION_ID}", method="DELETE"):
            request.view_args = {"session_id": SESSION_ID}
            with pytest.raises(NotFound, match="session not found"):
                CheckSessionOwnership().run(subject, _ctx(sqlite_session, subject=subject), sqlite_session)
