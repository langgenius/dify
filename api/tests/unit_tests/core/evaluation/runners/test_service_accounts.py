from collections.abc import Callable

import pytest
from sqlalchemy.orm import Session

from core.evaluation.runners import get_service_account_for_app, get_service_account_for_snippet
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.model import AppMode
from models.snippet import CustomizedSnippet
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant


@pytest.mark.parametrize(
    ("get_service_account", "target_id"),
    [
        (get_service_account_for_app, "app-1"),
        (get_service_account_for_snippet, "snippet-1"),
    ],
)
def test_get_service_account_sets_tenant_with_caller_session(
    get_service_account: Callable[[Session, str, str], Account], target_id: str, sqlite_session: Session
) -> None:
    """A persisted creator and membership are returned with the caller session's tenant context."""
    account = make_account()
    tenant = make_tenant()
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        role=TenantAccountRole.NORMAL,
    )
    target = (
        make_app(app_id=target_id, tenant_id=tenant.id, mode=AppMode.WORKFLOW, created_by=account.id)
        if target_id == "app-1"
        else CustomizedSnippet(
            id=target_id,
            tenant_id=tenant.id,
            name="Test snippet",
            type="node",
            is_published=True,
            version=1,
            use_count=0,
            created_by=account.id,
        )
    )
    sqlite_session.add_all([account, tenant, membership, target])
    sqlite_session.flush()

    result = get_service_account(sqlite_session, target_id, tenant.id)

    assert result is account
    assert result.current_tenant_id == tenant.id
    assert result.current_role == TenantAccountRole.NORMAL
