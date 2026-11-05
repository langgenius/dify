from __future__ import annotations

from collections.abc import Callable

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from controllers.openapi.auth.context import Context, RouteContractError
from controllers.openapi.auth.requirements import CheckWorkspaceMember
from core.logging.context import clear_request_context, init_request_context
from machinery.context import RequestContext
from models import TenantAccountJoin
from models.account import TenantAccountRole
from models.model import EndUser
from tests.e2e_tests.containers.controllers.openapi.conftest import context_for
from tests.helpers.unit.controllers.openapi.auth._world import (
    ACCOUNT_ID,
    APP_ID,
    OTHER_TENANT_ID,
    TENANT_ID,
    make_account,
    make_app,
    make_ctx,
    make_membership,
    make_tenant,
    persist,
)

"""The store hands handlers what the route loaded, and nothing else."""


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


"""Keep the integration handler context aligned with request-scoped identity loading."""


@pytest.mark.parametrize("view_args", [{"workspace_id": TENANT_ID}, {"app_id": APP_ID}])
def test_workspace_requirement_binds_fresh_caller_to_requested_workspace(
    sqlite_session: Session, view_args: dict[str, str]
) -> None:
    account = make_account()
    original_workspace = make_tenant(tenant_id=OTHER_TENANT_ID)
    requested_membership = make_membership(TenantAccountRole.ADMIN)
    requested_membership.current = False
    persist(
        sqlite_session,
        account,
        original_workspace,
        make_tenant(),
        make_app(),
        requested_membership,
        TenantAccountJoin(
            tenant_id=OTHER_TENANT_ID,
            account_id=ACCOUNT_ID,
            current=True,
            role=TenantAccountRole.OWNER,
        ),
    )
    account.set_current_tenant_with_session(original_workspace, session=sqlite_session)

    ctx = context_for(
        account,
        session=sqlite_session,
        view_args=view_args,
        requirements=(CheckWorkspaceMember(),),
    )

    assert ctx.account is not account
    assert object_session(ctx.account) is None
    assert ctx.account.current_tenant_id == ctx.workspace.id == TENANT_ID
    assert ctx.account.role == ctx.workspace_role == TenantAccountRole.ADMIN
    assert account.current_tenant_id == OTHER_TENANT_ID
    assert (
        sqlite_session.scalar(
            select(TenantAccountJoin.tenant_id).where(
                TenantAccountJoin.account_id == ACCOUNT_ID, TenantAccountJoin.current.is_(True)
            )
        )
        == OTHER_TENANT_ID
    )
    if "app_id" in view_args:
        assert ctx.app.id == APP_ID


def test_app_context_without_workspace_requirement_does_not_bind_workspace(sqlite_session: Session) -> None:
    account = make_account()
    persist(sqlite_session, account, make_tenant(), make_app(), make_membership())

    ctx = context_for(account, session=sqlite_session, view_args={"app_id": APP_ID})

    assert ctx.app.id == APP_ID
    assert ctx.account.current_tenant_id is None
    with pytest.raises(RouteContractError, match="workspace was not loaded"):
        _ = ctx.workspace
