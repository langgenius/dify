from typing import Protocol, cast

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
    delay_calls: list[dict[str, object]] = []

    def delay(**kwargs: object) -> None:
        delay_calls.append(kwargs)

    monkeypatch.setattr(collect_agent_resources, "delay", delay)

    enqueue_agent_resource_collection(tenant_id="tenant-1")
    enqueue_agent_resource_collection(
        tenant_id="tenant-1",
        binding_ids=["binding-2", "binding-1", "binding-2"],
        workspace_ids=["workspace-1"],
        purge_agent_ids=["agent-2", "", "agent-1", "agent-2"],
    )

    assert delay_calls == [
        {
            "tenant_id": "tenant-1",
            "binding_ids": ["binding-1", "binding-2"],
            "workspace_ids": ["workspace-1"],
            "home_snapshot_ids": [],
            "purge_agent_ids": ["agent-1", "agent-2"],
        }
    ]


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
    purge_calls: list[tuple[str, list[str]]] = []

    def purge(*, tenant_id: str, agent_ids: list[str]) -> None:
        purge_calls.append((tenant_id, agent_ids))
        calls.append("purge")

    monkeypatch.setattr(AgentDeletionService, "purge_archived_agents", purge)

    collect_agent_resources.run(
        tenant_id="tenant-1",
        workspace_ids=["workspace-1"],
        binding_ids=["binding-1"],
        home_snapshot_ids=["home-1"],
        purge_agent_ids=["agent-1"],
    )

    assert calls == ["workspace", "binding", "home", "purge"]
    assert purge_calls == [("tenant-1", ["agent-1"])]


def test_collection_failure_propagates_after_attempting_remaining_resources(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    first_error = RuntimeError("workspace-1 failed")
    errors = {
        "workspace-1": first_error,
        "workspace-2": RuntimeError("workspace-2 failed"),
        "binding-1": RuntimeError("binding-1 failed"),
        "home-2": RuntimeError("home-2 failed"),
    }
    logged_exceptions: list[tuple[str, dict[str, object]]] = []

    def log_exception(message: str, *, extra: dict[str, object]) -> None:
        logged_exceptions.append((message, extra))

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
    purge_calls: list[tuple[str, list[str]]] = []

    def purge(*, tenant_id: str, agent_ids: list[str]) -> None:
        purge_calls.append((tenant_id, agent_ids))

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
    assert purge_calls == []
    assert logged_exceptions == [
        (
            "Failed to collect retired Agent resource",
            {
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
    ]


def test_enqueue_failure_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("queue unavailable")
    delay_calls: list[dict[str, object]] = []
    logged_exceptions: list[tuple[str, dict[str, object]]] = []

    def delay(**kwargs: object) -> None:
        delay_calls.append(kwargs)
        raise error

    def log_exception(message: str, *, extra: dict[str, object]) -> None:
        logged_exceptions.append((message, extra))

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
    assert delay_calls == [{"tenant_id": "tenant-1", **payload}]
    assert logged_exceptions == [
        (
            "Failed to enqueue retired Agent resource collection",
            {"tenant_id": "tenant-1", **payload},
        )
    ]
