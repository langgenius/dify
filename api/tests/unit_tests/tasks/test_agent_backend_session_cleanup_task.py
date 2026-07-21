import logging
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot

from clients.agent_backend.session_cleanup import (
    AgentBackendSessionCleanupPayload,
    AgentBackendSessionCleanupResult,
)
from tasks import agent_backend_session_cleanup_task as cleanup_task_module


def _payload_dict() -> dict[str, object]:
    return AgentBackendSessionCleanupPayload(
        session_snapshot=CompositorSessionSnapshot(layers=[]),
        runtime_layer_specs=[],
        metadata={"tenant_id": "tenant-1", "app_id": "app-1"},
    ).model_dump(mode="json")


def test_run_cleanup_task_logs_info_for_skipped_result(monkeypatch, caplog):
    monkeypatch.setattr(cleanup_task_module, "_create_agent_backend_client", lambda: object())
    monkeypatch.setattr(
        cleanup_task_module,
        "cleanup_agent_backend_session",
        lambda **kwargs: AgentBackendSessionCleanupResult.skipped("missing_runtime_layer_specs"),
    )

    with caplog.at_level(logging.INFO, logger="tasks.agent_backend_session_cleanup_task"):
        cleanup_task_module._run_cleanup_task(_payload_dict())

    assert "Agent backend session cleanup skipped" in caplog.text
    assert "missing_runtime_layer_specs" in caplog.text


def test_run_cleanup_task_logs_warning_for_failed_result(monkeypatch, caplog):
    monkeypatch.setattr(cleanup_task_module, "_create_agent_backend_client", lambda: object())
    monkeypatch.setattr(
        cleanup_task_module,
        "cleanup_agent_backend_session",
        lambda **kwargs: AgentBackendSessionCleanupResult.failed(
            "backend exploded",
            cleanup_run_id="cleanup-run-1",
        ),
    )

    with caplog.at_level(logging.WARNING, logger="tasks.agent_backend_session_cleanup_task"):
        cleanup_task_module._run_cleanup_task(_payload_dict())

    assert "Agent backend session cleanup failed" in caplog.text
    assert "backend exploded" in caplog.text
    assert "cleanup-run-1" in caplog.text


def test_cleanup_agent_home_snapshots_uses_api_database_lifecycle(monkeypatch) -> None:
    session = MagicMock()
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    delete_all_for_agent = MagicMock()
    monkeypatch.setattr(cleanup_task_module.session_factory, "create_session", lambda: session_context)
    monkeypatch.setattr(
        cleanup_task_module.AgentHomeSnapshotService,
        "delete_all_for_agent",
        delete_all_for_agent,
    )

    cleanup_task_module.cleanup_agent_home_snapshots.run(tenant_id="tenant-1", agent_id="agent-1")

    delete_all_for_agent.assert_called_once_with(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
    )
    session.commit.assert_not_called()


def test_cleanup_agent_home_snapshots_propagates_delete_failure_without_commit(monkeypatch) -> None:
    session = MagicMock()
    session_context = MagicMock()
    session_context.__enter__.return_value = session
    delete_error = RuntimeError("backend delete failed")
    delete_all_for_agent = MagicMock(side_effect=delete_error)
    monkeypatch.setattr(cleanup_task_module.session_factory, "create_session", lambda: session_context)
    monkeypatch.setattr(
        cleanup_task_module.AgentHomeSnapshotService,
        "delete_all_for_agent",
        delete_all_for_agent,
    )

    with pytest.raises(RuntimeError, match="backend delete failed"):
        cleanup_task_module.cleanup_agent_home_snapshots.run(tenant_id="tenant-1", agent_id="agent-1")

    session.commit.assert_not_called()
