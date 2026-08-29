from __future__ import annotations

import ast
import inspect
from collections.abc import Callable
from types import ModuleType
from typing import NamedTuple, cast, get_args, get_type_hints

import pytest
from sqlalchemy.orm import Session

import controllers.openapi.auth.context as context_module
import controllers.openapi.auth.subjects as subjects_module
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import Subject
from models import Account, App, Tenant
from models.account import TenantAccountRole

from ._world import (
    APP_ID,
    TENANT_ID,
    make_account,
    make_app,
    make_tenant,
)

LOADERS = "controllers.openapi.auth.loaders"
SUBJECTS = "controllers.openapi.auth.subjects"


def _subject() -> Subject:
    """`Context` stores a `Subject` and never calls it; a bare object stands in."""
    return cast(Subject, object())


def bare_ctx(session: Session, **view_args: str) -> Context:
    """Deliberately not `_world.make_ctx`: the store has to be exercised with no
    real subject behind it, so the name differs from the shared builder's.
    """
    return Context(_subject(), session, dict(view_args))


class _Datum(NamedTuple):
    name: str
    read: Callable[[Context], object]
    loaded: Callable[[Context], bool]
    store: Callable[[Context, object], None]
    value: object


DATA = [
    _Datum("app", lambda c: c.app, lambda c: c.app_loaded, lambda c, v: c.set_app(cast(App, v)), make_app()),
    _Datum(
        "workspace",
        lambda c: c.workspace,
        lambda c: c.workspace_loaded,
        lambda c, v: c.set_workspace(cast(Tenant, v)),
        make_tenant(),
    ),
    _Datum(
        "workspace_role",
        lambda c: c.workspace_role,
        lambda c: c.workspace_role_loaded,
        lambda c, v: c.set_workspace_role(cast(TenantAccountRole, v)),
        TenantAccountRole.ADMIN,
    ),
    _Datum(
        "caller",
        lambda c: c.caller,
        lambda c: c.caller_loaded,
        lambda c, v: c.set_caller(cast(Account, v)),
        make_account(),
    ),
]


@pytest.mark.parametrize("datum", DATA, ids=[datum.name for datum in DATA])
def test_a_datum_is_stored_once_and_read_back_unchanged(sqlite_session: Session, datum: _Datum) -> None:
    ctx = bare_ctx(sqlite_session, app_id=APP_ID, workspace_id=TENANT_ID)

    assert datum.loaded(ctx) is False
    datum.store(ctx, datum.value)

    assert datum.loaded(ctx) is True
    assert datum.read(ctx) is datum.read(ctx) is datum.value


@pytest.mark.parametrize("datum", DATA, ids=[datum.name for datum in DATA])
def test_reading_a_datum_nothing_loaded_names_the_datum(sqlite_session: Session, datum: _Datum) -> None:
    """A programming error, not an HTTP status: no route should be able to reach
    a reader whose datum no requirement loads, so this is never a caller's answer.
    """
    ctx = bare_ctx(sqlite_session, app_id=APP_ID, workspace_id=TENANT_ID)

    with pytest.raises(LookupError, match=datum.name):
        datum.read(ctx)


def test_the_session_and_path_params_are_handed_over_at_construction(sqlite_session: Session) -> None:
    ctx = bare_ctx(sqlite_session, app_id=APP_ID)

    assert ctx.session is sqlite_session
    assert dict(ctx.view_args) == {"app_id": APP_ID}


def _imports(module: ModuleType, *, runtime_only: bool = False) -> set[str]:
    nodes = list(ast.walk(ast.parse(inspect.getsource(module))))
    if runtime_only:
        # A `TYPE_CHECKING` block never executes, so nothing in one can close a cycle.
        guarded = {
            child
            for node in nodes
            if isinstance(node, ast.If) and ast.unparse(node.test) == "TYPE_CHECKING"
            for child in ast.walk(node)
        }
        nodes = [node for node in nodes if node not in guarded]
    from_imports = {node.module for node in nodes if isinstance(node, ast.ImportFrom) and node.module}
    plain = {alias.name for node in nodes if isinstance(node, ast.Import) for alias in node.names}
    return from_imports | plain


def test_the_auth_import_graph_cannot_cycle() -> None:
    """A subject loads what it needs to resolve its caller, so `subjects` ->
    `loaders` -> `context` is a real runtime edge. The one that would close the
    ring is `context` -> `subjects`, and it is type-only. The store still
    reaches no service.
    """
    assert not [module for module in _imports(context_module) if module.split(".")[0] == "services"]

    runtime = _imports(context_module, runtime_only=True)

    assert SUBJECTS not in runtime
    assert LOADERS not in runtime
    assert SUBJECTS in _imports(context_module)
    assert LOADERS in _imports(subjects_module)


def test_no_reader_can_hand_a_handler_an_optional() -> None:
    """A `None` from a reader would reach a handler as a value it cannot tell
    from a real one. Readers answer with the concrete type or raise.
    """
    for datum in DATA:
        reader = vars(Context)[datum.name]
        assert isinstance(reader, property)
        assert reader.fget is not None
        returns = get_type_hints(reader.fget)["return"]
        # `caller` is a type alias, whose args are empty until it is unwrapped.
        returns = getattr(returns, "__value__", returns)  # guard-ignore: no-new-getattr -- alias unwrap
        assert type(None) not in get_args(returns)
