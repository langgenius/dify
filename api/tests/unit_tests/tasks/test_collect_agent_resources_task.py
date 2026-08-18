from typing import Protocol, cast
from unittest.mock import MagicMock

import pytest

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
    )

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        binding_ids=["binding-1", "binding-2"],
        workspace_ids=["workspace-1"],
        home_snapshot_ids=[],
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

    collect_agent_resources.run(
        tenant_id="tenant-1",
        workspace_ids=["workspace-1"],
        binding_ids=["binding-1"],
        home_snapshot_ids=["home-1"],
    )

    assert calls == ["workspace", "binding", "home"]


def test_collection_failure_propagates_and_stops_task(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    error = RuntimeError("workspace failed")
    log_exception = MagicMock()

    def collect_workspace(**_kwargs: object) -> None:
        calls.append("workspace")
        raise error

    monkeypatch.setattr(AgentWorkspaceService, "collect_retired_workspace", collect_workspace)
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
    monkeypatch.setattr("tasks.collect_agent_resources_task.logger.exception", log_exception)

    with pytest.raises(RuntimeError) as exc_info:
        collect_agent_resources.run(
            tenant_id="tenant-1",
            workspace_ids=["workspace-1"],
            binding_ids=["binding-1"],
            home_snapshot_ids=["home-1"],
        )

    assert exc_info.value is error
    assert calls == ["workspace"]
    log_exception.assert_called_once_with(
        "Failed to collect retired Agent resource",
        extra={
            "tenant_id": "tenant-1",
            "resource_type": "workspace",
            "resource_id": "workspace-1",
        },
    )


def test_enqueue_failure_is_best_effort(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        collect_agent_resources,
        "delay",
        MagicMock(side_effect=RuntimeError("queue unavailable")),
    )

    enqueue_agent_resource_collection(
        tenant_id="tenant-1",
        binding_ids=["binding-1"],
    )
