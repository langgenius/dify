from contextlib import nullcontext
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus
from services.agent.retirement_service import WorkflowAgentRetirementService
from tasks import agent_backend_session_cleanup_task as cleanup_task_module


def _workflow_agent(agent_id: str) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id="tenant-1",
        name=agent_id,
        description="",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
    )


def test_archive_unowned_preserves_effective_binding_and_archives_orphan(monkeypatch) -> None:
    retained = _workflow_agent("agent-retained")
    orphan = _workflow_agent("agent-orphan")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [retained, orphan]
    monkeypatch.setattr(
        WorkflowAgentRetirementService,
        "_effective_agent_ids",
        MagicMock(return_value={retained.id}),
    )

    retired = WorkflowAgentRetirementService.archive_unowned(
        session=session,
        tenant_id="tenant-1",
        agent_ids=[retained.id, orphan.id],
        account_id="account-1",
    )

    assert retired == [orphan.id]
    assert retained.status == AgentStatus.ACTIVE
    assert orphan.status == AgentStatus.ARCHIVED
    assert orphan.archived_by == "account-1"
    assert orphan.archived_at is not None
    session.flush.assert_called_once_with()


def test_schedule_dispatches_only_after_database_commit(monkeypatch) -> None:
    delay = MagicMock()
    monkeypatch.setattr(cleanup_task_module.retire_workflow_agents_if_unowned, "delay", delay)

    with Session() as session:
        WorkflowAgentRetirementService.schedule_after_commit(
            session=session,
            tenant_id="tenant-1",
            agent_ids=["agent-2", "agent-1", "agent-1"],
            account_id="account-1",
        )
        delay.assert_not_called()
        session.commit()

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        agent_ids=["agent-1", "agent-2"],
        account_id="account-1",
    )


def test_retirement_task_commits_archive_before_scheduling_home_cleanup(monkeypatch) -> None:
    session = MagicMock()
    context = MagicMock()
    context.__enter__.return_value = session
    monkeypatch.setattr(cleanup_task_module.session_factory, "create_session", lambda: context)
    archive = MagicMock(return_value=["agent-orphan"])
    monkeypatch.setattr(WorkflowAgentRetirementService, "archive_unowned", archive)
    cleanup_delay = MagicMock()
    monkeypatch.setattr(cleanup_task_module.cleanup_agent_home_snapshots, "delay", cleanup_delay)

    cleanup_task_module.retire_workflow_agents_if_unowned.run(
        tenant_id="tenant-1",
        agent_ids=["agent-orphan"],
        account_id="account-1",
    )

    archive.assert_called_once_with(
        session=session,
        tenant_id="tenant-1",
        agent_ids=["agent-orphan"],
        account_id="account-1",
    )
    session.commit.assert_called_once_with()
    cleanup_delay.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-orphan")


@pytest.mark.parametrize("sqlite_session", [(Agent,)], indirect=True)
def test_retirement_task_retry_reschedules_cleanup_for_already_archived_unowned_agent(
    monkeypatch,
    sqlite_session: Session,
) -> None:
    archived = _workflow_agent("agent-orphan")
    archived.status = AgentStatus.ARCHIVED
    sqlite_session.add(archived)
    sqlite_session.commit()
    monkeypatch.setattr(
        cleanup_task_module.session_factory,
        "create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(WorkflowAgentRetirementService, "_effective_agent_ids", MagicMock(return_value=set()))
    cleanup_delay = MagicMock(side_effect=[RuntimeError("broker unavailable"), None])
    monkeypatch.setattr(cleanup_task_module.cleanup_agent_home_snapshots, "delay", cleanup_delay)

    with pytest.raises(RuntimeError, match="broker unavailable"):
        cleanup_task_module.retire_workflow_agents_if_unowned.run(
            tenant_id="tenant-1",
            agent_ids=[archived.id],
            account_id="account-1",
        )

    cleanup_task_module.retire_workflow_agents_if_unowned.run(
        tenant_id="tenant-1",
        agent_ids=[archived.id],
        account_id="account-1",
    )

    assert archived.status == AgentStatus.ARCHIVED
    assert cleanup_delay.call_count == 2
