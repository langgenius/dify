from unittest.mock import MagicMock

from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService
from tasks.collect_agent_resources_task import (
    collect_agent_resources,
    enqueue_agent_resource_collection,
)


def test_collection_task_uses_retention_queue() -> None:
    assert getattr(collect_agent_resources, "queue", None) == "retention"


def test_enqueue_deduplicates_ids_and_skips_empty_input(monkeypatch) -> None:
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


def test_collection_continues_in_workspace_binding_snapshot_order(monkeypatch) -> None:
    calls: list[str] = []

    def collect_workspace(**_kwargs) -> None:
        calls.append("workspace")
        raise RuntimeError("workspace failed")

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

    collect_agent_resources.run(
        tenant_id="tenant-1",
        workspace_ids=["workspace-1"],
        binding_ids=["binding-1"],
        home_snapshot_ids=["home-1"],
    )

    assert calls == ["workspace", "binding", "home"]


def test_enqueue_failure_is_best_effort(monkeypatch) -> None:
    monkeypatch.setattr(
        collect_agent_resources,
        "delay",
        MagicMock(side_effect=RuntimeError("queue unavailable")),
    )

    enqueue_agent_resource_collection(
        tenant_id="tenant-1",
        binding_ids=["binding-1"],
    )
