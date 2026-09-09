from __future__ import annotations

from collections.abc import Callable
from typing import override
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.pipelines import (
    _PIPELINES,
    AccountPipeline,
    ExternalSsoPipeline,
    Pipeline,
)
from controllers.openapi.auth.requirements import (
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckSubject,
    CheckWorkspaceMember,
    Rank,
    Requirement,
)
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import _SUBJECT_CLASSES, AccountSubject, Subject
from enums import DeploymentEdition
from libs.oauth_bearer import AuthContext, try_get_auth_ctx
from services.account_service import AccountService, TenantService
from services.app_service import AppService
from services.end_user_service import EndUserService
from services.enterprise.enterprise_service import WebAppAccessMode

from ._world import (
    APP_ID,
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

MOUNT = "controllers.openapi.auth.pipelines._mount_flask_login"
FEATURES = "controllers.openapi.auth.requirements.SystemFeatureService.get_public_system_features"
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
        auth=subject.auth,
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
    that keeps `CheckSubject` ahead of `_RequiresEnterprise`, and the reason the sort
    has to stay stable.
    """
    log: list[str] = []

    class _FixedRecorders(Pipeline):
        fixed = (_Recorded(log, "fixed-a"), _Recorded(log, "fixed-b"))

    subject = sso_subject()
    requirements = (_Recorded(log, "spec-a"), _Recorded(log, "spec-b"))

    _run(_FixedRecorders(), subject, make_ctx(sqlite_session, subject), sqlite_session, requirements=requirements)

    assert log == ["spec-a", "spec-b", "fixed-a", "fixed-b"]


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

    assert seen == [subject.auth]
    assert try_get_auth_ctx() is None


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


def test_the_requirements_that_share_a_datum_fetch_it_once(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Both declared requirements need the app — `CheckAppApiEnabled` directly,
    `CheckWorkspaceMember` through the workspace it hangs off — and the
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
            requirements=(CheckAppApiEnabled(), CheckWorkspaceMember()),
        )

    assert (app_fetch.call_count, workspace_fetch.call_count, caller_fetch.call_count) == (1, 1, 1)


@pytest.mark.parametrize(
    ("requirements", "enable_api", "webapp_auth", "message"),
    [
        ((CheckSubject(allowed=[AccountSubject]),), True, False, "unsupported_token_type"),
        ((CheckAppApiEnabled(),), False, False, "service_api_disabled"),
        ((CheckAppAccess(),), True, True, "subject_not_allowed_for_access_mode"),
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


def test_every_registrable_subject_has_a_pipeline() -> None:
    assert set(_SUBJECT_CLASSES.values()) == set(_PIPELINES)
