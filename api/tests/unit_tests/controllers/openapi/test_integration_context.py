"""Keep the integration handler context aligned with request-scoped identity loading."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, object_session

from controllers.openapi.auth.context import RouteContractError
from controllers.openapi.auth.requirements import CheckWorkspaceMember
from models import TenantAccountJoin
from models.account import TenantAccountRole
from tests.test_containers_integration_tests.controllers.openapi.conftest import context_for
from tests.unit_tests.controllers.openapi.auth._world import (
    ACCOUNT_ID,
    APP_ID,
    OTHER_TENANT_ID,
    TENANT_ID,
    make_account,
    make_app,
    make_membership,
    make_tenant,
    persist,
)


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
