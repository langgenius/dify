"""The store hands handlers what the route loaded, and nothing else."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from controllers.openapi.auth.context import Context
from models.model import EndUser
from tests.unit_tests.controllers.openapi.auth._world import make_ctx

READERS: dict[str, Callable[[Context], object]] = {
    "app": lambda ctx: ctx.app,
    "workspace": lambda ctx: ctx.workspace,
    "workspace_role": lambda ctx: ctx.workspace_role,
    "caller": lambda ctx: ctx.caller,
    "account": lambda ctx: ctx.account,
    "end_user": lambda ctx: ctx.end_user,
}


@pytest.mark.parametrize("read", READERS.values(), ids=READERS.keys())
def test_an_unloaded_slot_is_an_error_not_a_fetch(sqlite_session: Session, read: Callable[[Context], object]) -> None:
    ctx = make_ctx(sqlite_session)
    with pytest.raises(LookupError, match="was not loaded"):
        read(ctx)


def test_the_caller_is_read_as_what_it_is(sqlite_session: Session) -> None:
    ctx = make_ctx(sqlite_session)
    ctx._caller = EndUser()
    with pytest.raises(LookupError, match="not the Account"):
        _ = ctx.account
