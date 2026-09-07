from typing import Protocol, cast
from unittest.mock import MagicMock, call

import pytest

from services.agent.deletion_service import AgentDeletionService
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService
from tasks.collect_agent_resources_task import (
    collect_agent_resources,
    enqueue_agent_resource_collection,
)


class _TaskWithQueue(Protocol):
    queue: str


def test_collection_task_uses_retention_queue() -> None:
    task = cast(_TaskWithQueue, collect_agent_resources)
    assert task.queue == "retention"


def test_enqueue_deduplicates_ids_and_skips_empty_input(monkeypatch: pytest.MonkeyPatch) -> None:
    delay = MagicMock()
    monkeypatch.setattr(collect_agent_resources, "delay", delay)

    enqueue_agent_resource_collection(tenant_id="tenant-1")
    enqueue_agent_resource_collection(
        tenant_id="tenant-1",
        binding_ids=["binding-2", "binding-1", "binding-2"],
        workspace_ids=["workspace-1"],
        purge_agent_ids=["agent-2", "", "agent-1", "agent-2"],
    )

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        binding_ids=["binding-1", "binding-2"],
        workspace_ids=["workspace-1"],
        home_snapshot_ids=[],
        purge_agent_ids=["agent-1", "agent-2"],
    )


def test_collection_runs_in_workspace_binding_snapshot_order(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(
        AgentWorkspaceService,
        "collect_retired_workspace",
        lambda **_kwargs: calls.append("workspace"),
    )
    monkeypatch.setattr(
        AgentWorkspaceService,
        "collect_retired_binding",
        lambda **_kwargs: calls.append("binding"),
    )
    monkeypatch.setattr(
        AgentHomeSnapshotService,
        "collect_retired_home_snapshot",
        lambda **_kwargs: calls.append("home"),
    )
    purge = MagicMock(side_effect=lambda **_kwargs: calls.append("purge"))
    monkeypatch.setattr(AgentDeletionService, "purge_archived_agents", purge)

    collect_agent_resources.run(
        tenant_id="tenant-1",
        workspace_ids=["workspace-1"],
        binding_ids=["binding-1"],
        home_snapshot_ids=["home-1"],
        purge_agent_ids=["agent-1"],
    )

    assert calls == ["workspace", "binding", "home", "purge"]
    purge.assert_called_once_with(tenant_id="tenant-1", agent_ids=["agent-1"])


def test_collection_failure_propagates_after_attempting_remaining_resources(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    first_error = RuntimeError("workspace-1 failed")
    errors = {
        "workspace-1": first_error,
        "workspace-2": RuntimeError("workspace-2 failed"),
        "binding-1": RuntimeError("binding-1 failed"),
        "home-2": RuntimeError("home-2 failed"),
    }
    log_exception = MagicMock()

    def collect_workspace(*, workspace_id: str, **_kwargs: object) -> None:
        calls.append(f"workspace:{workspace_id}")
        if error := errors.get(workspace_id):
            raise error

    def collect_binding(*, binding_id: str, **_kwargs: object) -> None:
        calls.append(f"binding:{binding_id}")
        if error := errors.get(binding_id):
            raise error

    def collect_home(*, home_snapshot_id: str, **_kwargs: object) -> None:
        calls.append(f"home:{home_snapshot_id}")
        if error := errors.get(home_snapshot_id):
            raise error

    monkeypatch.setattr(AgentWorkspaceService, "collect_retired_workspace", collect_workspace)
    monkeypatch.setattr(AgentWorkspaceService, "collect_retired_binding", collect_binding)
    monkeypatch.setattr(AgentHomeSnapshotService, "collect_retired_home_snapshot", collect_home)
    monkeypatch.setattr("tasks.collect_agent_resources_task.logger.exception", log_exception)
    purge = MagicMock()
    monkeypatch.setattr(AgentDeletionService, "purge_archived_agents", purge)

    with pytest.raises(RuntimeError) as exc_info:
        collect_agent_resources.run(
            tenant_id="tenant-1",
            workspace_ids=["workspace-1", "workspace-2", "workspace-3"],
            binding_ids=["binding-1", "binding-2"],
            home_snapshot_ids=["home-1", "home-2", "home-3"],
            purge_agent_ids=["agent-1"],
        )

    assert exc_info.value.__cause__ is first_error
    assert str(exc_info.value) == (
        "Failed to collect 4 retired Agent resource(s): "
        "workspace:workspace-1, workspace:workspace-2, binding:binding-1, home_snapshot:home-2"
    )
    assert calls == [
        "workspace:workspace-1",
        "workspace:workspace-2",
        "workspace:workspace-3",
        "binding:binding-1",
        "binding:binding-2",
        "home:home-1",
        "home:home-2",
        "home:home-3",
    ]
    purge.assert_not_called()
    log_exception.assert_has_calls(
        [
            call(
                "Failed to collect retired Agent resource",
                extra={
                    "tenant_id": "tenant-1",
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                },
            )
            for resource_type, resource_id in (
                ("workspace", "workspace-1"),
                ("workspace", "workspace-2"),
                ("binding", "binding-1"),
                ("home_snapshot", "home-2"),
            )
        ],
        any_order=False,
    )
    assert log_exception.call_count == 4


def test_enqueue_failure_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("queue unavailable")
    delay = MagicMock(side_effect=error)
    log_exception = MagicMock()
    monkeypatch.setattr(collect_agent_resources, "delay", delay)
    monkeypatch.setattr("tasks.collect_agent_resources_task.logger.exception", log_exception)

    with pytest.raises(RuntimeError) as exc_info:
        enqueue_agent_resource_collection(
            tenant_id="tenant-1",
            binding_ids=["binding-1"],
            workspace_ids=["workspace-1"],
            home_snapshot_ids=["home-1"],
            purge_agent_ids=["agent-2", "agent-1", "agent-2"],
        )

    assert exc_info.value is error
    payload = {
        "binding_ids": ["binding-1"],
        "workspace_ids": ["workspace-1"],
        "home_snapshot_ids": ["home-1"],
        "purge_agent_ids": ["agent-1", "agent-2"],
    }
    delay.assert_called_once_with(tenant_id="tenant-1", **payload)
    log_exception.assert_called_once_with(
        "Failed to enqueue retired Agent resource collection",
        extra={"tenant_id": "tenant-1", **payload},
    )
