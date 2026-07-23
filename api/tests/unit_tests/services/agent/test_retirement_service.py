from unittest.mock import MagicMock

from services.agent.retirement_service import WorkflowAgentRetirementService
from tasks import retire_workflow_agents_task as task_module


def test_schedule_after_commit_dispatches_deduplicated_candidates(monkeypatch) -> None:
    listeners: dict[str, object] = {}

    def listen(_session, event_name, callback, *, once):
        assert once is True
        listeners[event_name] = callback

    delay = MagicMock()
    monkeypatch.setattr("services.agent.retirement_service.event.listen", listen)
    monkeypatch.setattr("tasks.retire_workflow_agents_task.retire_workflow_agents_if_unowned.delay", delay)

    session = MagicMock()
    WorkflowAgentRetirementService.schedule_after_commit(
        session=session,
        tenant_id="tenant-1",
        agent_ids=["agent-2", "", "agent-1", "agent-2"],
        account_id="account-1",
    )
    listeners["after_commit"](session)

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        agent_ids=["agent-1", "agent-2"],
        account_id="account-1",
    )


def test_schedule_after_commit_is_cancelled_by_rollback(monkeypatch) -> None:
    listeners: dict[str, object] = {}
    monkeypatch.setattr(
        "services.agent.retirement_service.event.listen",
        lambda _session, event_name, callback, *, once: listeners.__setitem__(event_name, callback),
    )
    delay = MagicMock()
    monkeypatch.setattr("tasks.retire_workflow_agents_task.retire_workflow_agents_if_unowned.delay", delay)

    session = MagicMock()
    WorkflowAgentRetirementService.schedule_after_commit(
        session=session,
        tenant_id="tenant-1",
        agent_ids=["agent-1"],
        account_id=None,
    )
    listeners["after_rollback"](session)
    listeners["after_commit"](session)

    delay.assert_not_called()


def test_retire_workflow_agent_workspaces_task_uses_stable_ids(monkeypatch) -> None:
    store = MagicMock()
    monkeypatch.setattr(task_module, "WorkflowAgentWorkspaceStore", MagicMock(return_value=store))

    task_module.retire_workflow_agent_workspaces.run(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )

    store.retire_workflow_run.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id="run-1",
    )
