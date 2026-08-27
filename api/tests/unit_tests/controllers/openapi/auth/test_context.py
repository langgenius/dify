from __future__ import annotations

from typing import NoReturn, cast

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import Subject
from models import App, Tenant
from models.account import TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType
from services.app_service import AppService

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000003"


def _boom(*_args: object, **_kwargs: object) -> NoReturn:
    raise AssertionError("fetched when nothing should have asked")


class _StubSubject:
    def __init__(self) -> None:
        self.calls: list[tuple[object, Session]] = []
        self.caller = object()

    def resolve_caller(self, ctx: object, session: Session) -> object:
        self.calls.append((ctx, session))
        return self.caller


def _subject() -> Subject:
    """`_StubSubject` stands in for `Subject` structurally — `Context` only
    ever calls `resolve_caller` on it. Cast once here rather than annotating
    every `Context(...)` call site against the concrete stub type.
    """
    return cast(Subject, _StubSubject())


def _app(*, app_id: str = APP_ID, tenant_id: str = TENANT_ID) -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
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


def _tenant(*, tenant_id: str = TENANT_ID, status: TenantStatus = TenantStatus.NORMAL) -> Tenant:
    tenant = Tenant(name="OpenAPI tenant", status=status)
    tenant.id = tenant_id
    return tenant


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


class TestApp:
    def test_app_is_fetched_once(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        calls: list[int] = []
        app_row = _app()

        def _fake_get_app_by_id(*_args: object, **_kwargs: object) -> App:
            calls.append(1)
            return app_row

        monkeypatch.setattr(AppService, "get_app_by_id", _fake_get_app_by_id)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        assert ctx.app is ctx.app
        assert len(calls) == 1

    def test_app_404s_on_malformed_uuid(self, sqlite_session: Session) -> None:
        ctx = Context(_subject(), sqlite_session, {"app_id": "not-a-uuid"})
        with pytest.raises(NotFound, match="app not found"):
            _ = ctx.app

    def test_app_404s_when_missing_or_not_normal(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(AppService, "get_app_by_id", lambda *_a, **_k: None)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})
        with pytest.raises(NotFound, match="app not found"):
            _ = ctx.app

        archived = _app()
        archived.status = "archived"  # type: ignore[assignment]
        monkeypatch.setattr(AppService, "get_app_by_id", lambda *_a, **_k: archived)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})
        with pytest.raises(NotFound, match="app not found"):
            _ = ctx.app

    def test_nothing_is_fetched_until_asked(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(AppService, "get_app_by_id", _boom)

        Context(_subject(), sqlite_session, {"app_id": "x"})


class TestWorkspaceFromApp:
    def test_derives_workspace_from_the_apps_tenant_when_app_id_is_present(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app(), _tenant())

        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        assert ctx.workspace.id == TENANT_ID
        assert ctx.workspace_resolved is True

    @pytest.mark.parametrize("persist_archived", [True, False])
    def test_forbidden_when_the_apps_tenant_is_missing_or_archived(
        self, sqlite_session: Session, persist_archived: bool
    ) -> None:
        models: list[object] = [_app()]
        if persist_archived:
            models.append(_tenant(status=TenantStatus.ARCHIVE))
        _persist(sqlite_session, *models)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        with pytest.raises(Forbidden, match="workspace unavailable"):
            _ = ctx.workspace


class TestWorkspaceFromRequest:
    def test_reads_workspace_id_from_view_args_then_from_the_query_string(
        self, app: Flask, sqlite_session: Session
    ) -> None:
        _persist(sqlite_session, _tenant())

        with app.test_request_context("/test"):
            ctx = Context(_subject(), sqlite_session, {"workspace_id": TENANT_ID})
            assert ctx.workspace.id == TENANT_ID

        with app.test_request_context(f"/test?workspace_id={TENANT_ID}"):
            ctx = Context(_subject(), sqlite_session, {})
            assert ctx.workspace.id == TENANT_ID

    def test_not_found_when_workspace_id_is_missing_or_malformed(self, app: Flask, sqlite_session: Session) -> None:
        for view_args in ({}, {"workspace_id": "not-a-uuid"}):
            ctx = Context(_subject(), sqlite_session, view_args)
            with app.test_request_context("/test"), pytest.raises(NotFound, match="workspace not found"):
                _ = ctx.workspace

    @pytest.mark.parametrize("persist_archived", [True, False])
    def test_not_found_when_the_requested_tenant_is_missing_or_archived(
        self, app: Flask, sqlite_session: Session, persist_archived: bool
    ) -> None:
        if persist_archived:
            _persist(sqlite_session, _tenant(status=TenantStatus.ARCHIVE))
        ctx = Context(_subject(), sqlite_session, {"workspace_id": TENANT_ID})

        with app.test_request_context("/test"), pytest.raises(NotFound, match="workspace not found"):
            _ = ctx.workspace


class TestWorkspaceRuleSelection:
    def test_app_id_wins_the_tie_when_both_app_id_and_workspace_id_are_present(
        self, app: Flask, sqlite_session: Session
    ) -> None:
        """Both a nonexistent app tenant and an existing workspace_id tenant are
        present; `has_app` must select the app-derived rule (and its `Forbidden`
        status), never fall through to the request-derived `NotFound` rule.
        """
        _persist(sqlite_session, _app(), _tenant(tenant_id=OTHER_TENANT_ID))
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID, "workspace_id": OTHER_TENANT_ID})

        with app.test_request_context("/test"), pytest.raises(Forbidden, match="workspace unavailable"):
            _ = ctx.workspace


class TestWorkspaceResolved:
    def test_false_until_the_workspace_is_computed_then_true(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app(), _tenant())
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        assert ctx.workspace_resolved is False
        _ = ctx.workspace
        assert ctx.workspace_resolved is True

    def test_is_not_a_view_args_test(self, sqlite_session: Session) -> None:
        ctx = Context(_subject(), sqlite_session, {"workspace_id": TENANT_ID})

        assert ctx.workspace_resolved is False


class TestCaller:
    def test_delegates_to_subject_resolve_caller_and_caches_it(self, sqlite_session: Session) -> None:
        subject = _StubSubject()
        ctx = Context(cast(Subject, subject), sqlite_session, {})

        assert ctx.caller is ctx.caller
        assert ctx.caller is subject.caller
        assert subject.calls == [(ctx, sqlite_session)]
