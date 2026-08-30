from __future__ import annotations

from collections.abc import Callable
from typing import cast, override
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from configs import dify_config
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.pipelines import (
    AccountPipeline,
    ExternalSsoPipeline,
    Pipeline,
    _RequiresEnterprise,
)
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    Rank,
    Requirement,
    RequireWebappAccess,
    RequireWorkspaceMembership,
    ResolveCaller,
    SubjectCheck,
    TokenScope,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject, Subject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, Scope, SubjectType, try_get_auth_ctx
from models import Account, EndUser
from models.enums import EndUserType
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import WebAppAccessMode
from services.entities.feature_entities import LicenseStatus

from ._world import (
    APP_ID,
    SSO_EMAIL,
    TENANT_ID,
    account_subject,
    make_account,
    make_app,
    make_auth,
    make_ctx,
    make_membership,
    make_tenant,
    never_reached,
    persist,
    sso_subject,
    system_features,
    webapp_settings,
)

MOUNT = "controllers.openapi.auth.pipelines._mount_flask_login"
FEATURES = "controllers.openapi.auth.requirements.FeatureService.get_system_features"
ACCESS_MODE = "controllers.openapi.auth.requirements.EnterpriseService.WebAppAuth.get_app_access_mode_by_id"


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
        auth=make_auth(subject.subject_type),
        spec=EndpointSpec(requirements=requirements),
        ctx=ctx,
        session=session,
        call=call,
    )


def test_requirements_run_in_rank_order(sqlite_session: Session) -> None:
    log: list[str] = []
    subject = sso_subject()
    requirements = (_Recorded(log, "normal"), _AtEarly(log, "early"), _AtFirst(log, "first"))

    _run(_NoFixed(), subject, make_ctx(sqlite_session, subject), sqlite_session, requirements=requirements)

    assert log == ["first", "early", "normal"]


def test_equal_ranks_keep_declared_order(sqlite_session: Session) -> None:
    """Endpoint-declared before pipeline-fixed at equal rank — the property
    that keeps `SubjectCheck` ahead of `_RequiresEnterprise`, and the reason the sort
    has to stay stable.
    """
    log: list[str] = []

    class _FixedRecorders(Pipeline):
        fixed = (_Recorded(log, "fixed-a"), _Recorded(log, "fixed-b"))

    subject = sso_subject()
    requirements = (_Recorded(log, "spec-a"), _Recorded(log, "spec-b"))

    _run(_FixedRecorders(), subject, make_ctx(sqlite_session, subject), sqlite_session, requirements=requirements)

    assert log == ["spec-a", "spec-b", "fixed-a", "fixed-b"]


def test_fixed_requirements_reproduce_the_two_pipelines() -> None:
    """What every route of each subject gets, whatever it declares itself.
    Tuples, not lists: `fixed` is a ClassVar on a process-lifetime object.

    Nothing app-scoped is here: a fixed requirement runs on every route of its
    subject, including the ones with no `app_id` to check, so the app checks are
    declared per endpoint instead. What is left is true of every route.

    `ResolveCaller` is last in both and takes the default rank, which is what
    puts caller resolution after every endpoint-declared requirement — where
    the lazy context used to put it, at mount.
    """
    assert [type(requirement) for requirement in AccountPipeline.fixed] == [ResolveCaller]
    assert [type(requirement) for requirement in ExternalSsoPipeline.fixed] == [
        _RequiresEnterprise,
        ResolveCaller,
    ]
    assert ResolveCaller.rank is Rank.NORMAL
    assert _RequiresEnterprise.rank is Rank.FIRST
    assert isinstance(AccountPipeline.fixed, tuple)
    assert isinstance(ExternalSsoPipeline.fixed, tuple)


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE])
def test_the_external_sso_gate_refuses_a_non_enterprise_edition(
    edition: DeploymentEdition, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The gate that keeps a `dfoe_` token issued before a downgrade from working
    on the routes an account shares with it - the ones no `edition=` can cover,
    because the account still has to reach them.
    """
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", edition)
    subject = sso_subject()

    with patch(FEATURES, return_value=system_features(license_status=LicenseStatus.ACTIVE)):
        if edition is DeploymentEdition.ENTERPRISE:
            _RequiresEnterprise().run(subject, make_ctx(sqlite_session, subject), sqlite_session)
        else:
            with pytest.raises(Forbidden, match="external_sso_requires_ee"):
                _RequiresEnterprise().run(subject, make_ctx(sqlite_session, subject), sqlite_session)


def test_the_external_sso_gate_checks_the_edition_before_the_licence(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Same order as the router's endpoint-level gate: a CE deployment answers
    about the edition and never reaches the licence.
    """
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)
    subject = sso_subject()

    with patch(FEATURES, side_effect=never_reached):
        with pytest.raises(Forbidden, match="external_sso_requires_ee"):
            _RequiresEnterprise().run(subject, make_ctx(sqlite_session, subject), sqlite_session)


@pytest.mark.parametrize("view_raises", [False, True])
def test_auth_ctx_is_published_for_the_view_and_reset_after_it(
    sqlite_session: Session,
    view_raises: bool,
) -> None:
    subject = sso_subject()
    seen: list[AuthContext | None] = []

    def call(**_kwargs: object) -> None:
        seen.append(try_get_auth_ctx())
        if view_raises:
            raise RuntimeError("boom")

    ctx = make_ctx(sqlite_session, subject)
    if view_raises:
        with pytest.raises(RuntimeError):
            _run(_NoFixed(), subject, ctx, sqlite_session, call=call)
    else:
        _run(_NoFixed(), subject, ctx, sqlite_session, call=call)

    assert seen == [make_auth(SubjectType.EXTERNAL_SSO)]
    assert try_get_auth_ctx() is None


def test_a_subject_that_mounts_no_caller_leaves_the_context_untouched(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ExternalSsoSubject.mounts_caller` is false without an `app_id`, so an SSO
    request on an app-less route resolves no caller at all — `ResolveCaller` is
    where that policy is consulted, and `mounted` only reads what it stored.
    """
    monkeypatch.setattr(MOUNT, never_reached)
    subject = sso_subject()
    ctx = make_ctx(sqlite_session, subject)

    _run(_NoFixed(), subject, ctx, sqlite_session, requirements=(ResolveCaller(),))

    assert ctx.caller is None


def test_app_scoped_route_mounts_an_account_bound_to_the_workspace(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """H17 — an account that mounts with no current tenant fails silently,
    without an exception, so the guard has to be an assertion.
    """
    persist(sqlite_session, make_app(), make_tenant(), make_account(), make_membership())
    mounted: list[object] = []
    monkeypatch.setattr(MOUNT, mounted.append)
    subject = account_subject()

    _run(
        AccountPipeline(),
        subject,
        make_ctx(sqlite_session, subject, app_id=APP_ID),
        sqlite_session,
        requirements=(RequireWorkspaceMembership(),),
    )

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
    monkeypatch.setattr(MOUNT, never_reached)
    subject = account_subject()

    with pytest.raises(Unauthorized, match="account not found"):
        _run(AccountPipeline(), subject, make_ctx(sqlite_session, subject), sqlite_session)

    assert try_get_auth_ctx() is None


def test_endpoint_spec_keeps_requirements_as_a_tuple() -> None:
    """A list survives `__init__` and only fails where `Pipeline.run`
    concatenates, so the coercion belongs at construction.
    """
    declared = [CheckAppApiEnabled()]

    spec = EndpointSpec(requirements=cast(tuple[Requirement, ...], declared))

    assert spec.requirements == tuple(declared)
    assert isinstance(spec.requirements, tuple)


def test_the_requirements_that_share_a_datum_fetch_it_once(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both declared requirements need the app — `CheckAppApiEnabled` directly,
    `RequireWorkspaceMembership` through the workspace it hangs off — and the
    membership check and `ResolveCaller` both need the caller. Each is fetched once.
    """
    persist(sqlite_session, make_app(), make_tenant(), make_account(), make_membership())
    monkeypatch.setattr(MOUNT, lambda _user: None)
    subject = account_subject()

    with (
        patch.object(AppService, "get_app_by_id", wraps=AppService.get_app_by_id) as app_fetch,
        patch.object(TenantService, "get_tenant_by_id", wraps=TenantService.get_tenant_by_id) as workspace_fetch,
        patch.object(AccountService, "get_account_by_id", wraps=AccountService.get_account_by_id) as caller_fetch,
    ):
        _run(
            AccountPipeline(),
            subject,
            make_ctx(sqlite_session, subject, app_id=APP_ID),
            sqlite_session,
            requirements=(CheckAppApiEnabled(), RequireWorkspaceMembership()),
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
    monkeypatch.setattr(AppService, "get_app_by_id", never_reached)
    subject = account_subject()
    monkeypatch.setattr(subject, "mounts_caller", lambda _ctx: False)
    ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)

    _run(_NoFixed(), subject, ctx, sqlite_session, requirements=(TokenScope(Scope.APPS_RUN),))

    assert ctx.app is None


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
    persist(sqlite_session, make_app(), make_tenant())
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
    subject = sso_subject()
    ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)

    with patch(FEATURES, return_value=system_features()):
        _run(ExternalSsoPipeline(), subject, ctx, sqlite_session)

    assert ctx.workspace is not None
    assert ctx.caller is end_user
    assert mounted_users == [end_user]


def test_a_loaded_caller_is_not_mounted_when_the_subject_declines(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The mount follows `mounts_caller`, not "a caller happens to be loaded".
    A membership check resolves one on every account app route, so a subject
    that declines conditionally would otherwise be mounted against its own
    policy.
    """
    persist(sqlite_session, make_app(), make_tenant(), make_account(), make_membership())
    monkeypatch.setattr(MOUNT, never_reached)
    subject = account_subject()
    monkeypatch.setattr(subject, "mounts_caller", lambda _ctx: False)
    ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)

    _run(AccountPipeline(), subject, ctx, sqlite_session, requirements=(RequireWorkspaceMembership(),))

    assert ctx.caller is not None


@pytest.mark.parametrize(
    ("requirements", "enable_api", "webapp_auth", "message"),
    [
        ((SubjectCheck(allowed=[AccountSubject]),), True, False, "unsupported_token_type"),
        ((CheckAppApiEnabled(),), False, False, "service_api_disabled"),
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
    persist(sqlite_session, make_app(enable_api=enable_api), make_tenant())
    monkeypatch.setattr(MOUNT, never_reached)
    monkeypatch.setattr(EndUserService, "get_or_create_end_user_by_type", never_reached)
    subject = sso_subject()
    ctx = make_ctx(sqlite_session, subject, app_id=APP_ID)

    with app.test_request_context(f"/openapi/v1/apps/{APP_ID}:run"):
        with patch(FEATURES, return_value=system_features(webapp_auth=webapp_auth)):
            with patch(ACCESS_MODE, return_value=webapp_settings(WebAppAccessMode.PRIVATE_ALL.value)):
                with pytest.raises(Forbidden, match=message):
                    _run(ExternalSsoPipeline(), subject, ctx, sqlite_session, requirements=requirements)

    assert ctx.caller is None
