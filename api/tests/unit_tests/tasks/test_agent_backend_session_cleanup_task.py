import logging
from unittest.mock import MagicMock

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
