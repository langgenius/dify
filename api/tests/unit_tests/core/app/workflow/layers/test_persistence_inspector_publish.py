"""Verify the workflow persistence layer fans Inspector deltas to redis pub/sub.

The hook lives in ``core/app/workflow/layers/persistence.py``:
every ``_handle_node_*`` and the terminal ``_handle_graph_run_*`` handlers
call into ``services.workflow.inspector_events.publish_node_changed`` /
``publish_workflow_completed`` after the DB write succeeds. Those calls are
the only thing the Inspector SSE stream listens to, so any future refactor of
the persistence layer must keep them in place.

We don't reconstruct a full workflow engine here — the handlers are tested
in isolation by patching just the moving parts they touch
(``_workflow_execution`` + ``_node_execution_cache``) and asserting against
the publisher module's call sites. This keeps the test compact and tied to
the contract, not the implementation.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import MagicMock

import pytest

from core.app.workflow.layers import persistence as persistence_mod
from core.app.workflow.layers.persistence import WorkflowPersistenceLayer


@pytest.fixture
def layer() -> WorkflowPersistenceLayer:
    """Build a layer instance with all repository / trace deps stubbed.

    We bypass ``__init__`` because constructing it for real pulls in the
    workflow engine's app-generate-entity, repos, and a runtime state — none
    of which matter for asserting that the publish-hook fires.
    """
    instance = WorkflowPersistenceLayer.__new__(WorkflowPersistenceLayer)
    # Minimum surface the handlers touch:
    instance._workflow_execution_repository = MagicMock()
    instance._workflow_node_execution_repository = MagicMock()
    instance._trace_manager = None
    instance._workflow_info = MagicMock(workflow_id="wf-1")
    instance._application_generate_entity = MagicMock()
    # Use a SimpleNamespace-like spec so Pydantic-validated callsites (e.g.
    # ``WorkflowNodeExecution.new`` requires real strings) get the right types.
    workflow_execution = MagicMock()
    workflow_execution.id_ = "run-1"
    workflow_execution.workflow_id = "wf-1"
    workflow_execution.status = MagicMock(value="succeeded")
    workflow_execution.outputs = {}
    workflow_execution.error_message = None
    workflow_execution.exceptions_count = 0
    workflow_execution.finished_at = None
    instance._workflow_execution = workflow_execution
    instance._node_execution_cache = {}
    instance._node_snapshots = {}
    instance._node_sequence = 0
    # `graph_runtime_state` is a layer-base property; stub it.
    instance._graph_runtime_state = MagicMock(total_tokens=0, node_run_steps=0, outputs={}, exceptions_count=0)
    return instance


@pytest.fixture
def capture_publishes(monkeypatch: pytest.MonkeyPatch) -> dict[str, list]:
    """Replace the two publishers with capture lists so each test can assert
    on the exact arguments."""
    calls: dict[str, list] = {"node": [], "workflow": []}

    def fake_node(*, workflow_run_id: str, node_id: str, status: str) -> None:
        calls["node"].append({"workflow_run_id": workflow_run_id, "node_id": node_id, "status": status})

    def fake_workflow(*, workflow_run_id: str, status: str) -> None:
        calls["workflow"].append({"workflow_run_id": workflow_run_id, "status": status})

    monkeypatch.setattr(persistence_mod, "_inspector_publish_node_changed", fake_node)
    monkeypatch.setattr(persistence_mod, "_inspector_publish_workflow_completed", fake_workflow)
    return calls


# ──────────────────────────────────────────────────────────────────────────────
# Graph-level publish hooks
# ──────────────────────────────────────────────────────────────────────────────


def _graph_event(**kwargs: Any) -> MagicMock:
    return MagicMock(**kwargs)


def test_graph_run_succeeded_publishes_workflow_completed(layer, capture_publishes):
    layer._workflow_execution.status = MagicMock(value="succeeded")
    layer._handle_graph_run_succeeded(_graph_event(outputs={"text": "hi"}))
    assert capture_publishes["workflow"] == [{"workflow_run_id": "run-1", "status": "succeeded"}]
    assert capture_publishes["node"] == []


def test_graph_run_partial_succeeded_publishes_workflow_completed(layer, capture_publishes):
    layer._workflow_execution.status = MagicMock(value="partial-succeeded")
    layer._handle_graph_run_partial_succeeded(_graph_event(outputs={}, exceptions_count=1))
    assert capture_publishes["workflow"] == [{"workflow_run_id": "run-1", "status": "partial-succeeded"}]


def test_graph_run_failed_publishes_workflow_completed(layer, capture_publishes):
    layer._workflow_execution.status = MagicMock(value="failed")
    layer._handle_graph_run_failed(_graph_event(error="boom", exceptions_count=0))
    assert capture_publishes["workflow"] == [{"workflow_run_id": "run-1", "status": "failed"}]


def test_graph_run_aborted_publishes_workflow_completed(layer, capture_publishes):
    layer._workflow_execution.status = MagicMock(value="stopped")
    layer._handle_graph_run_aborted(_graph_event(reason="user stop"))
    assert capture_publishes["workflow"] == [{"workflow_run_id": "run-1", "status": "stopped"}]


def test_graph_run_paused_does_not_publish_completion(layer, capture_publishes):
    """Pause is not a terminal state — the Inspector keeps waiting for either
    resume or a real terminal event."""
    layer._handle_graph_run_paused(_graph_event(outputs={}))
    assert capture_publishes["workflow"] == []
    assert capture_publishes["node"] == []


# ──────────────────────────────────────────────────────────────────────────────
# Node-level publish hooks
# ──────────────────────────────────────────────────────────────────────────────


def _node_started_event(node_id: str = "agent-1", exec_id: str = "exec-1") -> MagicMock:
    return MagicMock(
        id=exec_id,
        node_id=node_id,
        node_type="agent",
        node_title="Greeter",
        predecessor_node_id=None,
        in_iteration_id=None,
        in_loop_id=None,
        start_at=datetime(2026, 5, 26, 0, 0, 0),
    )


def _seed_node_execution(layer: WorkflowPersistenceLayer, exec_id: str, node_id: str) -> None:
    """Inject a domain execution into the cache so the success / fail / etc
    handlers (which look it up by id) can run without going through started."""
    layer._node_execution_cache[exec_id] = MagicMock(
        id=exec_id, node_id=node_id, status=MagicMock(value="running"), outputs={}, error=None
    )


def test_node_started_publishes_running(layer, capture_publishes):
    layer._handle_node_started(_node_started_event())
    assert capture_publishes["node"] == [{"workflow_run_id": "run-1", "node_id": "agent-1", "status": "running"}]


def test_node_retry_publishes_retry(layer, capture_publishes):
    _seed_node_execution(layer, exec_id="exec-1", node_id="agent-1")
    event = MagicMock(id="exec-1", error="rate limit")
    layer._handle_node_retry(event)
    assert capture_publishes["node"] == [{"workflow_run_id": "run-1", "node_id": "agent-1", "status": "retry"}]


def test_node_succeeded_publishes_succeeded(layer, capture_publishes, monkeypatch: pytest.MonkeyPatch):
    _seed_node_execution(layer, exec_id="exec-1", node_id="agent-1")
    # Stub the inner _update_node_execution so we don't have to construct a
    # full NodeRunResult — we only want to confirm the publish happens after.
    monkeypatch.setattr(layer, "_update_node_execution", lambda *a, **kw: None)
    event = MagicMock(id="exec-1", node_run_result=MagicMock(), finished_at=datetime.now())
    layer._handle_node_succeeded(event)
    assert capture_publishes["node"] == [{"workflow_run_id": "run-1", "node_id": "agent-1", "status": "succeeded"}]


def test_node_failed_publishes_failed(layer, capture_publishes, monkeypatch: pytest.MonkeyPatch):
    _seed_node_execution(layer, exec_id="exec-1", node_id="agent-1")
    monkeypatch.setattr(layer, "_update_node_execution", lambda *a, **kw: None)
    event = MagicMock(id="exec-1", node_run_result=MagicMock(), error="bad", finished_at=datetime.now())
    layer._handle_node_failed(event)
    assert capture_publishes["node"] == [{"workflow_run_id": "run-1", "node_id": "agent-1", "status": "failed"}]


def test_node_exception_publishes_exception(layer, capture_publishes, monkeypatch: pytest.MonkeyPatch):
    _seed_node_execution(layer, exec_id="exec-1", node_id="agent-1")
    monkeypatch.setattr(layer, "_update_node_execution", lambda *a, **kw: None)
    event = MagicMock(id="exec-1", node_run_result=MagicMock(), error="oom", finished_at=datetime.now())
    layer._handle_node_exception(event)
    assert capture_publishes["node"] == [{"workflow_run_id": "run-1", "node_id": "agent-1", "status": "exception"}]


def test_node_pause_requested_does_not_publish(layer, capture_publishes, monkeypatch: pytest.MonkeyPatch):
    """Node pause is not an Inspector-visible state — no publish."""
    _seed_node_execution(layer, exec_id="exec-1", node_id="agent-1")
    monkeypatch.setattr(layer, "_update_node_execution", lambda *a, **kw: None)
    event = MagicMock(id="exec-1", node_run_result=MagicMock())
    layer._handle_node_pause_requested(event)
    assert capture_publishes["node"] == []
