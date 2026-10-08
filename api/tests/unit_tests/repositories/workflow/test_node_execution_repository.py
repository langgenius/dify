"""Execution response reads materialize creator data within its owner scope."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.account import TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel
from repositories.workflow.node_execution_repository import WorkflowNodeExecutionRepository
from tests.unit_tests.model_factories import make_account, make_end_user, make_tenant


@pytest.mark.parametrize("tenant_id", ["tenant-1", "other-tenant"])
def test_account_response_requires_execution_tenant_membership(
    sqlite_session_factory: sessionmaker[Session], tenant_id: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_account(),
                make_tenant(tenant_id=tenant_id),
                TenantAccountJoin(tenant_id=tenant_id, account_id="account-1", role=TenantAccountRole.OWNER),
            ]
        )
    execution = WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        app_id="app-1",
        created_by="account-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        offload_data=[],
    )
    result = WorkflowNodeExecutionRepository(sqlite_session_factory).execution_record(execution, include_details=True)
    assert result["created_by_end_user"] is None
    if tenant_id == "tenant-1":
        assert result["created_by_account"]["id"] == "account-1"
        assert isinstance(result["created_by_account"], dict)
    else:
        assert result["created_by_account"] is None


@pytest.mark.parametrize(
    ("tenant_id", "app_id"), [("tenant-1", "app-1"), ("other-tenant", "app-1"), ("tenant-1", "other-app")]
)
def test_end_user_response_requires_execution_tenant_and_app(
    sqlite_session_factory: sessionmaker[Session], tenant_id: str, app_id: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_end_user(tenant_id=tenant_id, app_id=app_id))
    execution = WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        app_id="app-1",
        created_by="end-user-1",
        created_by_role=CreatorUserRole.END_USER,
        offload_data=[],
    )
    result = WorkflowNodeExecutionRepository(sqlite_session_factory).execution_record(execution, include_details=True)
    assert result["created_by_account"] is None
    if (tenant_id, app_id) == ("tenant-1", "app-1"):
        assert result["created_by_end_user"]["id"] == "end-user-1"
        assert result["created_by_end_user"]["session_id"] == "session-1"
        assert isinstance(result["created_by_end_user"], dict)
    else:
        assert result["created_by_end_user"] is None
