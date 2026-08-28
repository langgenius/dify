from __future__ import annotations

from typing import NoReturn, cast

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_app, load_caller, load_workspace, load_workspace_role
from controllers.openapi.auth.subjects import Subject
from models import Account, App, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType
from services.account_service import TenantService
from services.app_service import AppService

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000003"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000004"


def _boom(*_args: object, **_kwargs: object) -> NoReturn:
    raise AssertionError("fetched when nothing should have asked")


class _StubSubject:
    def __init__(self, caller: object | None = None, account_id: str = ACCOUNT_ID) -> None:
        self.calls: list[tuple[object, Session]] = []
        self.caller = caller if caller is not None else object()
        self.account_id = account_id

    def resolve_caller(self, ctx: object, session: Session) -> object:
        self.calls.append((ctx, session))
        return self.caller


def _subject(caller: object | None = None) -> Subject:
    """`_StubSubject` stands in for `Subject` structurally — the loaders only
    ever call `resolve_caller` on it and read `account_id`. Cast once here
    rather than annotating every `Context(...)` call site against the concrete
    stub type.
    """
    return cast(Subject, _StubSubject(caller))


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


def _account(*, status: AccountStatus = AccountStatus.ACTIVE) -> Account:
    account = Account(name="OpenAPI account", email="account@example.com", status=status)
    account.id = ACCOUNT_ID
    return account


def _membership(role: TenantAccountRole = TenantAccountRole.NORMAL) -> TenantAccountJoin:
    return TenantAccountJoin(tenant_id=TENANT_ID, account_id=ACCOUNT_ID, current=True, role=role)


def _persist(session: Session, *models: object) -> None:
    session.add_all(models)
    session.commit()


class TestLoadApp:
    def test_the_app_is_fetched_once_and_stored(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        """The no-duplicate-fetch invariant at its smallest: the second caller
        reads the store, not the service.
        """
        calls: list[int] = []
        app_row = _app()

        def _fake_get_app_by_id(*_args: object, **_kwargs: object) -> App:
            calls.append(1)
            return app_row

        monkeypatch.setattr(AppService, "get_app_by_id", _fake_get_app_by_id)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        assert load_app(ctx) is load_app(ctx) is app_row
        assert len(calls) == 1
        assert ctx.app_loaded is True

    def test_404s_on_a_malformed_uuid(self, sqlite_session: Session) -> None:
        ctx = Context(_subject(), sqlite_session, {"app_id": "not-a-uuid"})
        with pytest.raises(NotFound, match="app not found"):
            load_app(ctx)

    def test_404s_when_missing_or_not_normal(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(AppService, "get_app_by_id", lambda *_a, **_k: None)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})
        with pytest.raises(NotFound, match="app not found"):
            load_app(ctx)

        archived = _app()
        archived.status = "archived"  # type: ignore[assignment]
        monkeypatch.setattr(AppService, "get_app_by_id", lambda *_a, **_k: archived)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})
        with pytest.raises(NotFound, match="app not found"):
            load_app(ctx)

    def test_a_failed_fetch_stores_nothing(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(AppService, "get_app_by_id", lambda *_a, **_k: None)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        with pytest.raises(NotFound):
            load_app(ctx)

        assert ctx.app_loaded is False


class TestWorkspaceFromApp:
    def test_derives_the_workspace_from_the_apps_tenant_when_app_id_is_present(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app(), _tenant())
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        assert load_workspace(ctx).id == TENANT_ID
        assert ctx.workspace_loaded is True
        assert ctx.app_loaded is True

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
            load_workspace(ctx)


class TestWorkspaceFromRequest:
    def test_reads_workspace_id_from_view_args_then_from_the_query_string(
        self, app: Flask, sqlite_session: Session
    ) -> None:
        _persist(sqlite_session, _tenant())

        with app.test_request_context("/test"):
            ctx = Context(_subject(), sqlite_session, {"workspace_id": TENANT_ID})
            assert load_workspace(ctx).id == TENANT_ID

        with app.test_request_context(f"/test?workspace_id={TENANT_ID}"):
            ctx = Context(_subject(), sqlite_session, {})
            assert load_workspace(ctx).id == TENANT_ID

    def test_not_found_when_workspace_id_is_missing_or_malformed(self, app: Flask, sqlite_session: Session) -> None:
        for view_args in ({}, {"workspace_id": "not-a-uuid"}):
            ctx = Context(_subject(), sqlite_session, view_args)
            with app.test_request_context("/test"), pytest.raises(NotFound, match="workspace not found"):
                load_workspace(ctx)

    @pytest.mark.parametrize("persist_archived", [True, False])
    def test_not_found_when_the_requested_tenant_is_missing_or_archived(
        self, app: Flask, sqlite_session: Session, persist_archived: bool
    ) -> None:
        if persist_archived:
            _persist(sqlite_session, _tenant(status=TenantStatus.ARCHIVE))
        ctx = Context(_subject(), sqlite_session, {"workspace_id": TENANT_ID})

        with app.test_request_context("/test"), pytest.raises(NotFound, match="workspace not found"):
            load_workspace(ctx)


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
            load_workspace(ctx)


class TestLoadCaller:
    def test_delegates_to_subject_resolve_caller_once(self, sqlite_session: Session) -> None:
        subject = _StubSubject()
        ctx = Context(cast(Subject, subject), sqlite_session, {})

        assert load_caller(ctx) is load_caller(ctx) is subject.caller
        assert subject.calls == [(ctx, sqlite_session)]


class TestLoadWorkspaceRole:
    def test_the_role_is_read_once_per_request(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        """Membership and the RBAC role floor both call this; the request pays
        for one SELECT, not one each.
        """
        _persist(sqlite_session, _app(), _tenant(), _account(), _membership(TenantAccountRole.ADMIN))
        calls: list[int] = []

        def _counted(*_args: object, **_kwargs: object) -> TenantAccountRole:
            calls.append(1)
            return TenantAccountRole.ADMIN

        monkeypatch.setattr(TenantService, "get_account_role_in_tenant", _counted)
        ctx = Context(_subject(_account()), sqlite_session, {"app_id": APP_ID})

        assert load_workspace_role(ctx) is TenantAccountRole.ADMIN
        assert load_workspace_role(ctx) is TenantAccountRole.ADMIN
        assert len(calls) == 1

    def test_reads_the_persisted_role(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app(), _tenant(), _account(), _membership(TenantAccountRole.EDITOR))
        ctx = Context(_subject(_account()), sqlite_session, {"app_id": APP_ID})

        assert load_workspace_role(ctx) == TenantAccountRole.EDITOR

    def test_404s_a_non_member(self, sqlite_session: Session) -> None:
        _persist(sqlite_session, _app(), _tenant(), _account())
        ctx = Context(_subject(_account()), sqlite_session, {"app_id": APP_ID})

        with pytest.raises(NotFound, match="workspace not found"):
            load_workspace_role(ctx)

    def test_404s_an_inactive_account_that_still_holds_a_role(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A banned admin is a non-member, and the role is never even read."""
        _persist(sqlite_session, _app(), _tenant(), _membership(TenantAccountRole.ADMIN))
        monkeypatch.setattr(TenantService, "get_account_role_in_tenant", _boom)
        ctx = Context(_subject(_account(status=AccountStatus.BANNED)), sqlite_session, {"app_id": APP_ID})

        with pytest.raises(NotFound, match="workspace not found"):
            load_workspace_role(ctx)

    def test_404s_a_caller_that_is_not_an_account(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _persist(sqlite_session, _app(), _tenant(), _membership(TenantAccountRole.ADMIN))
        monkeypatch.setattr(TenantService, "get_account_role_in_tenant", _boom)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        with pytest.raises(NotFound, match="workspace not found"):
            load_workspace_role(ctx)

    def test_loads_the_workspace_before_the_caller(self, sqlite_session: Session) -> None:
        """A subject binds the account's current tenant while resolving it, so
        the workspace has to be there already — loading the caller first would
        leave the account mounted with no current tenant, silently.
        """
        _persist(sqlite_session, _app(), _tenant(), _account(), _membership())
        loaded_when_called: list[bool] = []

        class _Recording(_StubSubject):
            def resolve_caller(self, ctx: object, session: Session) -> object:
                loaded_when_called.append(cast(Context, ctx).workspace_loaded)
                return super().resolve_caller(ctx, session)

        ctx = Context(cast(Subject, _Recording(_account())), sqlite_session, {"app_id": APP_ID})

        load_workspace_role(ctx)

        assert loaded_when_called == [True]
