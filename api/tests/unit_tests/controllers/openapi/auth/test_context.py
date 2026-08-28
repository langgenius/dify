from __future__ import annotations

import ast
import inspect
from collections.abc import Callable
from typing import NamedTuple, cast

import pytest
from sqlalchemy.orm import Session

import controllers.openapi.auth.context as context_module
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import Subject
from models import Account, App, Tenant
from models.account import AccountStatus, TenantAccountRole, TenantStatus
from models.enums import AppStatus
from models.model import AppMode, IconType

APP_ID = "00000000-0000-0000-0000-000000000001"
TENANT_ID = "00000000-0000-0000-0000-000000000002"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000004"


def _subject() -> Subject:
    """`Context` stores a `Subject` and never calls it; a bare object stands in."""
    return cast(Subject, object())


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


def _ctx(session: Session, **view_args: str) -> Context:
    return Context(_subject(), session, dict(view_args))


class _Datum(NamedTuple):
    name: str
    read: Callable[[Context], object]
    loaded: Callable[[Context], bool]
    store: Callable[[Context, object], None]
    value: object


DATA = [
    _Datum("app", lambda c: c.app, lambda c: c.app_loaded, lambda c, v: c.set_app(cast(App, v)), _app()),
    _Datum(
        "workspace",
        lambda c: c.workspace,
        lambda c: c.workspace_loaded,
        lambda c, v: c.set_workspace(cast(Tenant, v)),
        _tenant(),
    ),
    _Datum(
        "workspace_role",
        lambda c: c.workspace_role,
        lambda c: c.workspace_role_loaded,
        lambda c, v: c.set_workspace_role(cast(TenantAccountRole, v)),
        TenantAccountRole.ADMIN,
    ),
    _Datum(
        "caller", lambda c: c.caller, lambda c: c.caller_loaded, lambda c, v: c.set_caller(cast(Account, v)), _account()
    ),
]


@pytest.mark.parametrize("datum", DATA, ids=[datum.name for datum in DATA])
def test_a_datum_is_stored_once_and_read_back_unchanged(sqlite_session: Session, datum: _Datum) -> None:
    ctx = _ctx(sqlite_session, app_id=APP_ID, workspace_id=TENANT_ID)

    assert datum.loaded(ctx) is False
    datum.store(ctx, datum.value)

    assert datum.loaded(ctx) is True
    assert datum.read(ctx) is datum.read(ctx) is datum.value


@pytest.mark.parametrize("datum", DATA, ids=[datum.name for datum in DATA])
def test_reading_a_datum_nothing_loaded_names_the_datum(sqlite_session: Session, datum: _Datum) -> None:
    """A programming error, not an HTTP status: no route should be able to reach
    a reader whose datum no requirement loads, so this is never a caller's answer.
    """
    ctx = _ctx(sqlite_session, app_id=APP_ID, workspace_id=TENANT_ID)

    with pytest.raises(LookupError, match=datum.name):
        datum.read(ctx)


def test_the_view_args_derived_facts_need_no_loading(sqlite_session: Session) -> None:
    assert _ctx(sqlite_session, app_id=APP_ID).has_app is True
    assert _ctx(sqlite_session, workspace_id=TENANT_ID).has_app is False


def test_loaded_is_not_a_view_args_test(sqlite_session: Session) -> None:
    """A path param says a datum *can* be resolved, never that it was."""
    ctx = _ctx(sqlite_session, app_id=APP_ID, workspace_id=TENANT_ID)

    assert (ctx.app_loaded, ctx.workspace_loaded) == (False, False)


def test_the_session_and_path_params_are_handed_over_at_construction(sqlite_session: Session) -> None:
    ctx = _ctx(sqlite_session, app_id=APP_ID)

    assert ctx.session is sqlite_session
    assert dict(ctx.view_args) == {"app_id": APP_ID}


def test_the_store_reaches_no_service() -> None:
    """The store's whole contract. It also keeps the import graph acyclic:
    `context` -> `subjects`, and the loaders sit above both.
    """
    tree = ast.parse(inspect.getsource(context_module))
    imported = {
        node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module is not None
    } | {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}

    assert not [module for module in imported if module.split(".")[0] == "services"]
    assert "controllers.openapi.auth.loaders" not in imported
