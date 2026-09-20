from __future__ import annotations

from collections.abc import Callable
from typing import cast, override

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import (
    load_app,
    load_end_user,
    load_workspace,
    load_workspace_role,
)
from controllers.openapi.auth.subjects import Subject
from models import App
from models.account import TenantAccountRole, TenantStatus
from services.account_service import TenantService
from services.app_service import AppService

from ._world import (
    ACCOUNT_ID,
    APP_ID,
    OTHER_TENANT_ID,
    TENANT_ID,
    make_account,
    make_app,
    make_membership,
    make_tenant,
    never_reached,
    persist,
)


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


def _archived_app() -> App:
    app = make_app()
    app.status = "archived"  # type: ignore[assignment]
    return app


class TestLoadApp:
    @pytest.mark.parametrize(
        ("app_id", "fetched"),
        [
            ("not-a-uuid", never_reached),
            (APP_ID, lambda: None),
            (APP_ID, _archived_app),
        ],
        ids=["malformed uuid", "missing", "not normal"],
    )
    def test_404s_when_the_app_cannot_be_served(
        self,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
        app_id: str,
        fetched: Callable[[], App | None],
    ) -> None:
        monkeypatch.setattr(AppService, "get_app_by_id", lambda *_a, **_k: fetched())
        ctx = Context(_subject(), sqlite_session, {"app_id": app_id})

        with pytest.raises(NotFound, match="app not found"):
            load_app(ctx)

    def test_a_bare_hex_app_id_names_the_same_app(self, sqlite_session: Session) -> None:
        """The path parameter is whatever the caller typed; the row is keyed by the
        canonical dashed form. Normalising here is what lets one spelling of a UUID
        reach the app another spelling stored.
        """
        persist(sqlite_session, make_app())
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID.replace("-", "")})

        assert load_app(ctx).id == APP_ID

    @pytest.mark.parametrize("persist_archived", [True, False])
    def test_forbidden_when_the_apps_tenant_is_missing_or_archived(
        self, sqlite_session: Session, persist_archived: bool
    ) -> None:
        models: list[object] = [make_app()]
        if persist_archived:
            models.append(make_tenant(status=TenantStatus.ARCHIVE))
        persist(sqlite_session, *models)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        with pytest.raises(Forbidden, match="workspace unavailable"):
            load_workspace(ctx)


class TestWorkspaceFromRequest:
    @pytest.mark.parametrize(
        ("view_args", "persisted_status"),
        [
            ({}, None),
            ({"workspace_id": "not-a-uuid"}, None),
            ({"workspace_id": TENANT_ID}, None),
            ({"workspace_id": TENANT_ID}, TenantStatus.ARCHIVE),
        ],
        ids=["no workspace_id", "malformed workspace_id", "missing tenant", "archived tenant"],
    )
    def test_not_found_when_the_workspace_cannot_be_served(
        self,
        app: Flask,
        sqlite_session: Session,
        view_args: dict[str, str],
        persisted_status: TenantStatus | None,
    ) -> None:
        if persisted_status is not None:
            persist(sqlite_session, make_tenant(status=persisted_status))
        ctx = Context(_subject(), sqlite_session, view_args)

        with app.test_request_context("/test"), pytest.raises(NotFound, match="workspace not found"):
            load_workspace(ctx)


class TestWorkspaceRuleSelection:
    def test_app_id_wins_the_tie_when_both_app_id_and_workspace_id_are_present(
        self, app: Flask, sqlite_session: Session
    ) -> None:
        """Both a nonexistent app tenant and an existing workspace_id tenant are
        present; `route_has_app` must select the app-derived rule (and its
        `Forbidden` status), never fall through to the request-derived `NotFound`
        rule.
        """
        persist(sqlite_session, make_app(), make_tenant(tenant_id=OTHER_TENANT_ID))
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID, "workspace_id": OTHER_TENANT_ID})

        with app.test_request_context("/test"), pytest.raises(Forbidden, match="workspace unavailable"):
            load_workspace(ctx)


class TestLoadWorkspaceRole:
    def test_the_role_is_read_once_per_request(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        """Membership and the RBAC role floor both call this; the request pays
        for one SELECT, not one each.
        """
        persist(sqlite_session, make_app(), make_tenant(), make_account(), make_membership(TenantAccountRole.ADMIN))
        calls: list[int] = []

        def _counted(*_args: object, **_kwargs: object) -> TenantAccountRole:
            calls.append(1)
            return TenantAccountRole.ADMIN

        monkeypatch.setattr(TenantService, "get_account_role_in_tenant", _counted)
        ctx = Context(_subject(make_account()), sqlite_session, {"app_id": APP_ID})

        assert load_workspace_role(ctx) is TenantAccountRole.ADMIN
        assert load_workspace_role(ctx) is TenantAccountRole.ADMIN
        assert len(calls) == 1

    def test_404s_a_caller_that_is_not_an_account(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        persist(sqlite_session, make_app(), make_tenant(), make_membership(TenantAccountRole.ADMIN))
        monkeypatch.setattr(TenantService, "get_account_role_in_tenant", never_reached)
        ctx = Context(_subject(), sqlite_session, {"app_id": APP_ID})

        with pytest.raises(NotFound, match="workspace not found"):
            load_workspace_role(ctx)

    def test_loads_the_workspace_before_the_caller(self, sqlite_session: Session) -> None:
        """A subject binds the account's current tenant while resolving it, so
        the workspace has to be there already — loading the caller first would
        leave the account mounted with no current tenant, silently.
        """
        persist(sqlite_session, make_app(), make_tenant(), make_account(), make_membership())
        loaded_when_called: list[bool] = []

        class _Recording(_StubSubject):
            @override
            def resolve_caller(self, ctx: object, session: Session) -> object:
                loaded_when_called.append(cast(Context, ctx).workspace is not None)
                return super().resolve_caller(ctx, session)

        ctx = Context(cast(Subject, _Recording(make_account())), sqlite_session, {"app_id": APP_ID})

        load_workspace_role(ctx)

        assert loaded_when_called == [True]


class TestNarrowingLoaders:
    def test_load_end_user_refuses_an_account(self, sqlite_session: Session) -> None:
        ctx = Context(cast(Subject, _StubSubject(caller=make_account())), sqlite_session, {})

        with pytest.raises(Forbidden, match="unsupported_token_type"):
            load_end_user(ctx)
