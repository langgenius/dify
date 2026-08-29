from __future__ import annotations

import ast
import dataclasses
import inspect
from types import ModuleType
from typing import cast

from sqlalchemy.orm import Session

import controllers.openapi.auth.context as context_module
import controllers.openapi.auth.subjects as subjects_module
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.subjects import Subject

from ._world import APP_ID, TENANT_ID, make_app

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


def test_every_datum_starts_unset(sqlite_session: Session) -> None:
    """Unset is the whole protocol between the store and `loaders.py`: a field
    that arrived already filled would skip the fetch that vets it.
    """
    ctx = bare_ctx(sqlite_session, app_id=APP_ID, workspace_id=TENANT_ID)

    assert (ctx.app, ctx.workspace, ctx.workspace_role, ctx.caller) == (None, None, None, None)


def test_what_is_handed_over_at_construction_is_what_is_read_back(sqlite_session: Session) -> None:
    ctx = bare_ctx(sqlite_session, app_id=APP_ID)
    app = make_app()

    ctx.app = app

    assert ctx.session is sqlite_session
    assert dict(ctx.view_args) == {"app_id": APP_ID}
    assert ctx.app is app


def test_the_store_declares_no_behaviour() -> None:
    """ "Only stores", as an assertion. A reader, a loaded-check or a fetch helper
    on `Context` would put request logic back where a requirement can neither see
    it nor decline it — so every public name here has to be a field and nothing else.
    """
    fields = {field.name for field in dataclasses.fields(Context)}

    assert {name for name in vars(Context) if not name.startswith("_")} <= fields


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
