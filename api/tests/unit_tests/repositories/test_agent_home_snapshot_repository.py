from datetime import datetime

from sqlalchemy.orm import Session

from models.agent import AgentHomeSnapshot, AgentWorkingResourceStatus
from repositories.agent.home_snapshot_repository import AgentHomeSnapshotRepository


def test_retirement_is_scoped_retryable_and_owned_by_callers_transaction(sqlite_session: Session) -> None:
    earlier = datetime(2025, 1, 1)
    active = AgentHomeSnapshot(id="active", tenant_id="tenant", agent_id="agent", snapshot_ref="active-ref")
    retired = AgentHomeSnapshot(
        id="retired",
        tenant_id="tenant",
        agent_id="agent",
        snapshot_ref="retired-ref",
        status=AgentWorkingResourceStatus.RETIRED,
        retired_at=earlier,
    )
    other_agent = AgentHomeSnapshot(id="other", tenant_id="tenant", agent_id="other", snapshot_ref="other-ref")
    other_tenant = AgentHomeSnapshot(id="foreign", tenant_id="foreign", agent_id="agent", snapshot_ref="foreign-ref")
    sqlite_session.add_all([active, retired, other_agent, other_tenant])
    sqlite_session.commit()
    repository = AgentHomeSnapshotRepository(sqlite_session)

    assert set(repository.retire_all_for_agent(tenant_id="tenant", agent_id="agent")) == {"active", "retired"}
    now = active.retired_at
    assert now is not None
    assert retired.retired_at == earlier
    assert other_agent.status == other_tenant.status == AgentWorkingResourceStatus.ACTIVE
    assert set(repository.retire_all_for_agent(tenant_id="tenant", agent_id="agent")) == {"active", "retired"}
    assert active.retired_at == now

    sqlite_session.rollback()
    assert active.status == AgentWorkingResourceStatus.ACTIVE
    assert active.retired_at is None
    assert retired.status == AgentWorkingResourceStatus.RETIRED
    assert retired.retired_at == earlier
