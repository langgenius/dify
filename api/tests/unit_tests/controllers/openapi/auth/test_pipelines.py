from __future__ import annotations

import uuid
from collections.abc import Callable
from functools import partial
from typing import NoReturn, cast, override
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.pipelines import AccountPipeline, ExternalSsoPipeline, Pipeline
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckAppWorkspaceMembership,
    EditionCheck,
    LicenseCheck,
    Rank,
    Requirement,
    RequireWebappAccess,
    ResolveCaller,
    SubjectCheck,
    TokenScope,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, Subject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, Scope, SubjectType, TokenType, try_get_auth_ctx
from models import Account, App, EndUser, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus, EndUserType
from models.model import AppMode, IconType
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.end_user_service import EndUserService
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
SSO_EMAIL = "user@sso.com"

MOUNT = "controllers.openapi.auth.pipelines._mount_flask_login"
FEATURES = "controllers.openapi.auth.requirements.FeatureService.get_system_features"
ACCESS_MODE = "controllers.openapi.auth.requirements.EnterpriseService.WebAppAuth.get_app_access_mode_by_id"


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


def _tenant() -> Tenant:
    tenant = Tenant(name="OpenAPI tenant", status=TenantStatus.NORMAL)
    tenant.id = TENANT_ID
    return tenant


def _account() -> Account:
    account = Account(name="OpenAPI account", email="account@example.com", status=AccountStatus.ACTIVE)
    account.id = ACCOUNT_ID
    return account


def _membership() -> TenantAccountJoin:
    return TenantAccountJoin(
        tenant_id=TENANT_ID,
        account_id=ACCOUNT_ID,
        current=True,
        role=TenantAccountRole.NORMAL,
    )


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


def _active_licence(*, webapp_auth: bool = False) -> SystemFeatureModel:
    return SystemFeatureModel(
        deployment_edition=DeploymentEdition.ENTERPRISE,
        license=LicenseStatusModel(status=LicenseStatus.ACTIVE),
        webapp_auth=WebAppAuthModel(enabled=webapp_auth),
    )


def _settings(access_mode: str) -> WebAppSettings:
    return WebAppSettings.model_validate({"accessMode": access_mode})


def _boom(*_args: object, **_kwargs: object) -> NoReturn:
    raise AssertionError("reached an effect the pipeline should have skipped")


class _Recorded(Requirement):
    """Shared plumbing for the ordering test doubles. Declares no rank of its
    own, so a bare instance proves `Requirement`'s default applies.
    """

    def __init__(self, log: list[str], name: str) -> None:
        self._log = log
        self._name = name

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        self._log.append(self._name)


class _AtFirst(_Recorded):
    rank = Rank.FIRST


class _AtEarly(_Recorded):
    rank = Rank.EARLY


class _NoFixed(Pipeline):
    pass


def _account_subject() -> AccountSubject:
    return AccountSubject(_auth(SubjectType.ACCOUNT))


def _sso_subject() -> ExternalSsoSubject:
    """App-less SSO mounts no caller, so a test about ordering or plumbing
    needs neither an account row nor a stubbed mount.
    """
    return ExternalSsoSubject(_auth(SubjectType.EXTERNAL_SSO))


def _ctx(session: Session, subject: Subject, **view_args: str) -> Context:
    return Context(subject, session, dict(view_args))


def _run(
    pipeline: Pipeline,
    subject: Subject,
    ctx: Context,
    session: Session,
    *,
    requirements: tuple[Requirement, ...] = (),
    call: Callable[..., object] = lambda **_kwargs: None,
) -> object:
    return pipeline.run(
        subject=subject,
        auth=_auth(subject.subject_type),
        spec=EndpointSpec(requirements=requirements),
        ctx=ctx,
        session=session,
        call=call,
    )


def test_requirements_run_in_rank_order(sqlite_session: Session) -> None:
    log: list[str] = []
    subject = _sso_subject()
    requirements = (_Recorded(log, "normal"), _AtEarly(log, "early"), _AtFirst(log, "first"))

    _run(_NoFixed(), subject, _ctx(sqlite_session, subject), sqlite_session, requirements=requirements)

    assert log == ["first", "early", "normal"]


def test_equal_ranks_keep_declared_order(sqlite_session: Session) -> None:
    """Endpoint-declared before pipeline-fixed at equal rank — the property
    that keeps `SubjectCheck` ahead of `EditionCheck`, and the reason the sort
    has to stay stable.
    """
    log: list[str] = []

    class _FixedRecorders(Pipeline):
        fixed = (_Recorded(log, "fixed-a"), _Recorded(log, "fixed-b"))

    subject = _sso_subject()
    requirements = (_Recorded(log, "spec-a"), _Recorded(log, "spec-b"))

    _run(_FixedRecorders(), subject, _ctx(sqlite_session, subject), sqlite_session, requirements=requirements)

    assert log == ["spec-a", "spec-b", "fixed-a", "fixed-b"]


def test_fixed_requirements_reproduce_the_two_pipelines() -> None:
    """What every route of each subject gets, whatever it declares itself.
    Tuples, not lists: `fixed` is a ClassVar on a process-lifetime object.

    `ResolveCaller` is last in both and takes the default rank, which is what
    puts caller resolution after every endpoint-declared requirement — where
    the lazy context used to put it, at mount.
    """
    assert [type(requirement) for requirement in AccountPipeline.fixed] == [
        CheckAppApiEnabled,
        CheckAppWorkspaceMembership,
        ResolveCaller,
    ]
    assert [type(requirement) for requirement in ExternalSsoPipeline.fixed] == [
        EditionCheck,
        LicenseCheck,
        CheckAppApiEnabled,
        ResolveCaller,
    ]
    assert ResolveCaller.rank is Rank.NORMAL
    edition_check = ExternalSsoPipeline.fixed[0]
    assert isinstance(edition_check, EditionCheck)
    assert edition_check.editions == frozenset({DeploymentEdition.ENTERPRISE})
    assert isinstance(AccountPipeline.fixed, tuple)
    assert isinstance(ExternalSsoPipeline.fixed, tuple)


@pytest.mark.parametrize("view_raises", [False, True])
def test_auth_ctx_is_published_for_the_view_and_reset_after_it(
    sqlite_session: Session,
    view_raises: bool,
) -> None:
    subject = _sso_subject()
    seen: list[AuthContext | None] = []

    def call(**_kwargs: object) -> None:
        seen.append(try_get_auth_ctx())
        if view_raises:
            raise RuntimeError("boom")

    ctx = _ctx(sqlite_session, subject)
    if view_raises:
        with pytest.raises(RuntimeError):
            _run(_NoFixed(), subject, ctx, sqlite_session, call=call)
    else:
        _run(_NoFixed(), subject, ctx, sqlite_session, call=call)

    assert seen == [_auth(SubjectType.EXTERNAL_SSO)]
    assert try_get_auth_ctx() is None


def test_a_subject_that_mounts_no_caller_leaves_the_context_untouched(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ExternalSsoSubject.mounts_caller` is false without an `app_id`, so an SSO
    request on an app-less route resolves no caller at all — `ResolveCaller` is
    where that policy is consulted, and `mounted` only reads what it stored.
    """
    monkeypatch.setattr(MOUNT, _boom)
    subject = _sso_subject()
    ctx = _ctx(sqlite_session, subject)

    _run(_NoFixed(), subject, ctx, sqlite_session, requirements=(ResolveCaller(),))

    assert ctx.caller_loaded is False


def test_app_scoped_route_mounts_an_account_bound_to_the_workspace(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """H17 — an account that mounts with no current tenant fails silently,
    without an exception, so the guard has to be an assertion.
    """
    _persist(sqlite_session, _app(), _tenant(), _account(), _membership())
    mounted: list[object] = []
    monkeypatch.setattr(MOUNT, mounted.append)
    subject = _account_subject()

    _run(AccountPipeline(), subject, _ctx(sqlite_session, subject, app_id=APP_ID), sqlite_session)

    assert len(mounted) == 1
    account = mounted[0]
    assert isinstance(account, Account)
    assert account.current_tenant_id == TENANT_ID


def test_a_caller_that_cannot_be_resolved_leaves_the_auth_ctx_unset(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A token outliving its account raises inside `ResolveCaller`, which is a
    requirement and so runs before `mounted`. Resolving after `set_auth_ctx`
    would strand the identity on the ContextVar that `libs/rate_limit` buckets
    on, with no reset to undo it.
    """
    monkeypatch.setattr(MOUNT, _boom)
    subject = _account_subject()

    with pytest.raises(Unauthorized, match="account not found"):
        _run(AccountPipeline(), subject, _ctx(sqlite_session, subject), sqlite_session)

    assert try_get_auth_ctx() is None


def test_endpoint_spec_keeps_requirements_as_a_tuple() -> None:
    """A list survives `__init__` and only fails where `Pipeline.run`
    concatenates, so the coercion belongs at construction.
    """
    declared = [CheckAppApiEnabled()]

    spec = EndpointSpec(requirements=cast(tuple[Requirement, ...], declared))

    assert spec.requirements == tuple(declared)
    assert isinstance(spec.requirements, tuple)


def test_the_view_keeps_its_own_arguments_and_gains_the_context(sqlite_session: Session) -> None:
    subject = _sso_subject()
    ctx = _ctx(sqlite_session, subject)
    received: dict[str, object] = {}

    def view(resource: str, *, body: str, ctx: Context) -> str:
        received.update(resource=resource, body=body, ctx=ctx)
        return "answered"

    result = _run(_NoFixed(), subject, ctx, sqlite_session, call=partial(view, "self", body="payload"))

    assert result == "answered"
    assert received == {"resource": "self", "body": "payload", "ctx": ctx}


def test_the_requirements_that_share_a_datum_fetch_it_once(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Three requirements on this route need the app — the endpoint's own
    `CheckAppApiEnabled`, the pipeline's, and `ResolveCaller` — and two of them
    need the workspace and the caller. Each is fetched once.
    """
    _persist(sqlite_session, _app(), _tenant(), _account(), _membership())
    monkeypatch.setattr(MOUNT, lambda _user: None)
    subject = _account_subject()

    with (
        patch.object(AppService, "get_app_by_id", wraps=AppService.get_app_by_id) as app_fetch,
        patch.object(TenantService, "get_tenant_by_id", wraps=TenantService.get_tenant_by_id) as workspace_fetch,
        patch.object(AccountService, "get_account_by_id", wraps=AccountService.get_account_by_id) as caller_fetch,
    ):
        _run(
            AccountPipeline(),
            subject,
            _ctx(sqlite_session, subject, app_id=APP_ID),
            sqlite_session,
            requirements=(CheckAppApiEnabled(),),
        )

    assert (app_fetch.call_count, workspace_fetch.call_count, caller_fetch.call_count) == (1, 1, 1)


def test_a_route_whose_requirements_need_no_app_never_fetches_one(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`app_id` in the path says the app *can* be resolved, never that it is.
    Nothing fetches a datum no requirement asked for.

    The subject declines the mount, which is what lets a pipeline carry no
    `ResolveCaller` — the only shape in which an `app_id` can reach the mount
    with the app still unfetched.
    """
    monkeypatch.setattr(AppService, "get_app_by_id", _boom)
    subject = _account_subject()
    monkeypatch.setattr(subject, "mounts_caller", lambda _ctx: False)
    ctx = _ctx(sqlite_session, subject, app_id=APP_ID)

    _run(_NoFixed(), subject, ctx, sqlite_session, requirements=(TokenScope(Scope.APPS_RUN),))

    assert ctx.app_loaded is False


def test_an_external_sso_app_route_resolves_its_end_user(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    """`ExternalSsoSubject.resolve_caller` reads the workspace, and
    `ExternalSsoPipeline` carries no membership check — so `ResolveCaller`
    loading it is the only reason this route works.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    _persist(sqlite_session, _app(), _tenant())
    mounted_users: list[object] = []
    monkeypatch.setattr(MOUNT, mounted_users.append)
    end_user = EndUser(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.OPENAPI,
        is_anonymous=False,
        session_id=SSO_EMAIL,
    )
    monkeypatch.setattr(EndUserService, "get_or_create_end_user_by_type", lambda *_a, **_k: end_user)
    subject = _sso_subject()
    ctx = _ctx(sqlite_session, subject, app_id=APP_ID)

    with patch(FEATURES, return_value=_active_licence()):
        _run(ExternalSsoPipeline(), subject, ctx, sqlite_session)

    assert ctx.workspace_loaded is True
    assert ctx.caller is end_user
    assert mounted_users == [end_user]


def test_an_account_route_with_neither_app_nor_workspace_binds_no_tenant(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`/account` resolves a caller and nothing else: no path param names a
    workspace, so the account mounts with no current tenant.
    """
    _persist(sqlite_session, _account(), _tenant(), _membership())
    monkeypatch.setattr(MOUNT, lambda _user: None)
    subject = _account_subject()
    ctx = _ctx(sqlite_session, subject)

    _run(AccountPipeline(), subject, ctx, sqlite_session)

    caller = ctx.caller
    assert isinstance(caller, Account)
    assert caller.current_tenant_id is None
    assert (ctx.app_loaded, ctx.workspace_loaded) == (False, False)


def test_a_loaded_caller_is_not_mounted_when_the_subject_declines(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The mount follows `mounts_caller`, not "a caller happens to be loaded".
    A membership check resolves one on every account app route, so a subject
    that declines conditionally would otherwise be mounted against its own
    policy.
    """
    _persist(sqlite_session, _app(), _tenant(), _account(), _membership())
    monkeypatch.setattr(MOUNT, _boom)
    subject = _account_subject()
    monkeypatch.setattr(subject, "mounts_caller", lambda _ctx: False)
    ctx = _ctx(sqlite_session, subject, app_id=APP_ID)

    _run(AccountPipeline(), subject, ctx, sqlite_session)

    assert ctx.caller_loaded is True


@pytest.mark.parametrize(
    ("requirements", "enable_api", "webapp_auth", "message"),
    [
        ((SubjectCheck(allowed=[AccountSubject]),), True, False, "unsupported_token_type"),
        ((), False, False, "service_api_disabled"),
        ((RequireWebappAccess(),), True, True, "subject_not_allowed_for_access_mode"),
    ],
    ids=["wrong subject (FIRST)", "api disabled (EARLY)", "webapp acl (NORMAL)"],
)
def test_a_refused_sso_request_never_creates_an_end_user(
    app: Flask,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    requirements: tuple[Requirement, ...],
    enable_api: bool,
    webapp_auth: bool,
    message: str,
) -> None:
    """`ResolveCaller` mints an `EndUser` row, so it has to run after every
    requirement that can refuse — one refusal per band, because a rank that
    moved it earlier would side-effect before the gate that exists to stop it.
    """
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
    _persist(sqlite_session, _app(enable_api=enable_api), _tenant())
    monkeypatch.setattr(MOUNT, _boom)
    monkeypatch.setattr(EndUserService, "get_or_create_end_user_by_type", _boom)
    subject = _sso_subject()
    ctx = _ctx(sqlite_session, subject, app_id=APP_ID)

    with app.test_request_context(f"/openapi/v1/apps/{APP_ID}:run"):
        with patch(FEATURES, return_value=_active_licence(webapp_auth=webapp_auth)):
            with patch(ACCESS_MODE, return_value=_settings(WebAppAccessMode.PRIVATE_ALL.value)):
                with pytest.raises(Forbidden, match=message):
                    _run(ExternalSsoPipeline(), subject, ctx, sqlite_session, requirements=requirements)

    assert ctx.caller_loaded is False
