from __future__ import annotations

import uuid
from collections.abc import Callable
from functools import partial
from typing import NoReturn, cast, override

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.pipelines import AccountPipeline, ExternalSsoPipeline, Pipeline
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckAppWorkspaceMembership,
    EditionCheck,
    LicenseCheck,
    Rank,
    Requirement,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, Subject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, SubjectType, TokenType, try_get_auth_ctx
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000003"
TOKEN_ID = "00000000-0000-0000-0000-000000000004"
SSO_EMAIL = "user@sso.com"

MOUNT = "controllers.openapi.auth.pipelines._mount_flask_login"


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
    """
    assert [type(requirement) for requirement in AccountPipeline.fixed] == [
        CheckAppApiEnabled,
        CheckAppWorkspaceMembership,
    ]
    assert [type(requirement) for requirement in ExternalSsoPipeline.fixed] == [
        EditionCheck,
        LicenseCheck,
        CheckAppApiEnabled,
    ]
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
    request on an app-less route resolves no caller at all. Reading `ctx.caller`
    here would both change that and defeat the lazy context.
    """
    monkeypatch.setattr(MOUNT, _boom)
    subject = _sso_subject()
    ctx = _ctx(sqlite_session, subject)

    _run(_NoFixed(), subject, ctx, sqlite_session)

    assert "caller" not in ctx.__dict__


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
    """A token outliving its account raises inside `ctx.caller`. Resolving
    after `set_auth_ctx` would strand the identity on the ContextVar that
    `libs/rate_limit` buckets on, with no reset to undo it.
    """
    monkeypatch.setattr(MOUNT, _boom)
    subject = _account_subject()

    with pytest.raises(Unauthorized, match="account not found"):
        _run(_NoFixed(), subject, _ctx(sqlite_session, subject), sqlite_session)

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
