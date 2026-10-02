"""The store hands handlers what the route loaded, and nothing else."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from controllers.openapi.auth.context import Context, RouteContractError
from core.logging.context import clear_request_context, init_request_context
from machinery.context import RequestContext
from models.model import EndUser
from tests.unit_tests.controllers.openapi.auth._world import ACCOUNT_ID, TENANT_ID, make_ctx, make_tenant

READERS: dict[str, Callable[[Context], object]] = {
    "app": lambda ctx: ctx.app,
    "workspace": lambda ctx: ctx.workspace,
    "workspace_role": lambda ctx: ctx.workspace_role,
    "caller": lambda ctx: ctx.caller,
    "account": lambda ctx: ctx.account,
    "end_user": lambda ctx: ctx.end_user,
    "request_context": lambda ctx: ctx.request_context,
}


@pytest.mark.parametrize("read", READERS.values(), ids=READERS.keys())
def test_an_unloaded_slot_is_an_error_not_a_fetch(sqlite_session: Session, read: Callable[[Context], object]) -> None:
    ctx = make_ctx(sqlite_session)
    with pytest.raises(RouteContractError, match="was not loaded"):
        read(ctx)


def test_the_caller_is_read_as_what_it_is(sqlite_session: Session) -> None:
    ctx = make_ctx(sqlite_session)
    ctx._caller = EndUser()
    with pytest.raises(RouteContractError, match="not the Account"):
        _ = ctx.account


def test_application_context_keeps_identity_after_request_and_session_end(sqlite_session: Session) -> None:
    init_request_context()
    try:
        ctx = make_ctx(sqlite_session)
        ctx._workspace = make_tenant()
        snapshot = ctx.request_context
        assert snapshot.request_id
        assert snapshot.trace_id
    finally:
        clear_request_context()
    sqlite_session.close()

    assert ctx.request_context == snapshot
    assert snapshot == RequestContext(snapshot.request_id, snapshot.trace_id, ACCOUNT_ID, TENANT_ID)
