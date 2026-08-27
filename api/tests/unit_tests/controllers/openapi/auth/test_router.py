from __future__ import annotations

import uuid
from collections.abc import Callable
from types import SimpleNamespace
from typing import NoReturn

import pytest
from flask import Flask, request
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.pipelines import AccountPipeline
from controllers.openapi.auth.requirements import Requirement, SubjectCheck
from controllers.openapi.auth.router import AuthRouter, subject_router
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, SubjectType, TokenType
from models import Account, App
from models.account import AccountStatus
from models.enums import AppStatus
from models.model import AppMode, IconType
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
SSO_EMAIL = "user@sso.com"

ROUTER = "controllers.openapi.auth.router"
FEATURES = "controllers.openapi.auth.requirements.FeatureService.get_system_features"
MOUNT = "controllers.openapi.auth.pipelines._mount_flask_login"
ENTERPRISE_ONLY = frozenset({DeploymentEdition.ENTERPRISE})


def _auth(subject_type: SubjectType) -> AuthContext:
    is_account = subject_type is SubjectType.ACCOUNT
    return AuthContext(
        subject_type=subject_type,
        subject_email=None if is_account else SSO_EMAIL,
        subject_issuer=None if is_account else "https://idp.example",
        account_id=uuid.UUID(ACCOUNT_ID) if is_account else None,
        client_id="openapi-client",
        scopes=subject_type.scopes,
        token_id=uuid.UUID(TOKEN_ID),
        token_type=TokenType.OAUTH_ACCOUNT if is_account else TokenType.OAUTH_EXTERNAL_SSO,
        expires_at=None,
    )


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


def _account() -> Account:
    account = Account(name="OpenAPI account", email="account@example.com", status=AccountStatus.ACTIVE)
    account.id = ACCOUNT_ID
    return account


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


def _features(license_status: LicenseStatus) -> SystemFeatureModel:
    return SystemFeatureModel(
        deployment_edition=DeploymentEdition.ENTERPRISE,
        license=LicenseStatusModel(status=license_status),
        webapp_auth=WebAppAuthModel(enabled=False),
    )


def _boom(*_args: object, **_kwargs: object) -> NoReturn:
    raise AssertionError("reached a step the router should have answered before")


def _authenticates(monkeypatch: pytest.MonkeyPatch, auth: AuthContext) -> None:
    authenticator = SimpleNamespace(authenticate=lambda _token: auth)
    monkeypatch.setattr(f"{ROUTER}.get_authenticator", lambda: authenticator)


def _guard(
    view: Callable[..., object],
    *,
    requirements: tuple[Requirement, ...] = (),
    edition: frozenset[DeploymentEdition] | None = None,
    write: bool = True,
    router: AuthRouter = subject_router,
) -> Callable[..., object]:
    return router.guard(EndpointSpec(requirements=requirements, edition=edition, write=write))(view)


def _nothing(**_kwargs: object) -> None:
    return None


def test_every_subject_type_has_a_pipeline() -> None:
    """A new `SubjectType` with no entry still 403s `unsupported_token_type`,
    but at the router's lookup — skipping `SubjectCheck`'s wrong-surface audit.
    """
    assert set(subject_router._pipelines) == set(SubjectType)


def test_endpoint_edition_gate_404s_before_the_bearer_is_read(
    app: Flask,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(f"{ROUTER}.extract_bearer", _boom)
    view = _guard(_nothing, edition=ENTERPRISE_ONLY)

    with app.test_request_context("/openapi/v1/permitted-external-apps"):
        with pytest.raises(NotFound):
            view()


def test_a_dead_licence_403s_an_unauthenticated_caller_on_an_ee_endpoint(
    app: Flask,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The endpoint licence check fires before `extract_bearer`, so a caller
    with no bearer at all sees 403, not 401.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    monkeypatch.setattr(FEATURES, lambda: _features(LicenseStatus.EXPIRED))
    view = _guard(_nothing, edition=ENTERPRISE_ONLY)

    with app.test_request_context("/openapi/v1/permitted-external-apps"):
        with pytest.raises(Forbidden, match="license_invalid"):
            view()


def test_a_missing_bearer_401s(app: Flask) -> None:
    view = _guard(_nothing)

    with app.test_request_context("/openapi/v1/account"):
        with pytest.raises(Unauthorized, match="bearer required"):
            view()


def test_a_subject_with_no_pipeline_403s(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    _authenticates(monkeypatch, _auth(SubjectType.EXTERNAL_SSO))
    account_only = AuthRouter({SubjectType.ACCOUNT: AccountPipeline()})
    view = _guard(_nothing, router=account_only)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        with pytest.raises(Forbidden, match="unsupported_token_type"):
            view()


def test_an_account_token_reaches_the_view_with_a_resolved_context(
    app: Flask,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist(sqlite_session, _account())
    _authenticates(monkeypatch, _auth(SubjectType.ACCOUNT))
    mounted: list[object] = []
    monkeypatch.setattr(MOUNT, mounted.append)
    seen: dict[str, object] = {}

    def handler(resource: str, *, ctx: Context) -> str:
        seen.update(resource=resource, ctx=ctx)
        return "answered"

    view = _guard(handler)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        result = view("self")

    assert result == "answered"
    assert isinstance(seen["ctx"], Context)
    assert isinstance(seen["ctx"].subject, AccountSubject)
    assert seen["resource"] == "self"
    assert [type(user) for user in mounted] == [Account]


def test_path_params_reach_the_context(
    app: Flask,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`CheckAppApiEnabled` is fixed on the account pipeline, so it only fires
    when the router has put the route's `app_id` on the context.
    """
    _persist(sqlite_session, _app(enable_api=False))
    _authenticates(monkeypatch, _auth(SubjectType.ACCOUNT))
    view = _guard(_nothing)

    with app.test_request_context(f"/openapi/v1/apps/{APP_ID}", headers={"Authorization": "Bearer tok"}):
        request.view_args = {"app_id": APP_ID}
        with pytest.raises(Forbidden, match="service_api_disabled"):
            view()


def test_an_sso_token_is_refused_on_a_community_deployment(
    app: Flask,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    _authenticates(monkeypatch, _auth(SubjectType.EXTERNAL_SSO))
    view = _guard(_nothing)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        with pytest.raises(Forbidden, match="external_sso_requires_ee"):
            view()


def test_the_endpoint_subject_check_answers_before_the_pipeline_edition_check(
    app: Flask,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Today's token-type gate runs before the route's edition gate, so an SSO
    token on an account-only route is `unsupported_token_type` even on a
    deployment where the SSO pipeline itself is unavailable.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    _authenticates(monkeypatch, _auth(SubjectType.EXTERNAL_SSO))
    view = _guard(_nothing, requirements=(SubjectCheck(allowed=[AccountSubject]),))

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        with pytest.raises(Forbidden, match="unsupported_token_type"):
            view()


def _rename_handler(*, ctx: Context) -> str:
    ctx.caller.name = "renamed"
    return "ok"


def test_write_true_by_default_commits_a_mutation_on_success(
    app: Flask,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist(sqlite_session, _account())
    _authenticates(monkeypatch, _auth(SubjectType.ACCOUNT))
    monkeypatch.setattr(MOUNT, lambda _user: None)
    view = _guard(_rename_handler)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        view()

    with sqlite_session_factory() as verify:
        assert verify.get(Account, ACCOUNT_ID).name == "renamed"


def test_write_false_does_not_persist_a_mutation(
    app: Flask,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist(sqlite_session, _account())
    _authenticates(monkeypatch, _auth(SubjectType.ACCOUNT))
    monkeypatch.setattr(MOUNT, lambda _user: None)
    view = _guard(_rename_handler, write=False)

    with app.test_request_context("/openapi/v1/account", headers={"Authorization": "Bearer tok"}):
        view()

    with sqlite_session_factory() as verify:
        assert verify.get(Account, ACCOUNT_ID).name == "OpenAPI account"
