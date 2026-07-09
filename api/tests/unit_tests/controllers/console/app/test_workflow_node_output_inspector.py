"""Unit tests for the Node Output Inspector controller (Stage 4 §8).

The controller has two non-trivial moving parts:

1. :func:`_sse_envelope` — wire-format builder for the SSE ``{event, data, id}``
   records (decision D-5).
2. :func:`_stream_inspector_events` — the SSE generator that fans the redis
   pub/sub stream out as snapshot / node_changed / workflow_run_completed /
   error events.

We exercise both as plain functions with mocked dependencies (service +
``inspector_events.subscribe``) — going through Flask routes would multiply
the test scaffolding without buying additional confidence in the core
behaviour.

The Resource classes themselves are trivial wrappers (``_service().method()``
+ ``_InspectorNotFound`` translation), and are touched here only by import so
codecov sees them as exercised; their detailed behaviour is locked down by
the service-level tests in
``tests/unit_tests/services/workflow/test_node_output_inspector_service.py``.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any
from unittest.mock import ANY, MagicMock
from uuid import UUID

import pytest

from controllers.console.app import workflow_node_output_inspector as ctrl
from services.workflow.inspector_events import InspectorMessage
from services.workflow.node_output_inspector_service import (
    NodeOutputInspectorError,
    NodeOutputStatus,
    NodeOutputsView,
    NodeStatus,
    WorkflowRunSnapshotView,
)

# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def app_model() -> Any:
    """A minimal ``App`` stub the controller passes through to the service.

    The SSE generator never reads its attributes — just forwards it — so a
    sentinel object is enough.
    """
    return MagicMock(name="App", tenant_id="tenant-1", id="app-1")


@pytest.fixture
def run_id() -> UUID:
    return UUID("00000000-0000-0000-0000-0000000000aa")


def _snapshot_view(*, status: str, node_id: str = "agent-1") -> WorkflowRunSnapshotView:
    from graphon.enums import WorkflowExecutionStatus

    return WorkflowRunSnapshotView(
        workflow_run_id="00000000-0000-0000-0000-0000000000aa",
        workflow_run_status=WorkflowExecutionStatus(status),
        node_outputs=[
            NodeOutputsView(
                node_id=node_id,
                node_kind="agent",
                node_display_name="Greeter",
                node_status=NodeStatus.RUNNING if status == "running" else NodeStatus.READY,
                outputs=[],
            )
        ],
    )


def _node_view(*, node_id: str = "agent-1", node_status: NodeStatus = NodeStatus.READY) -> NodeOutputsView:
    return NodeOutputsView(
        node_id=node_id,
        node_kind="agent",
        node_display_name="Greeter",
        node_status=node_status,
        outputs=[],
    )


# ──────────────────────────────────────────────────────────────────────────────
# _sse_envelope
# ──────────────────────────────────────────────────────────────────────────────


def test_sse_envelope_serializes_dict_payload():
    out = ctrl._sse_envelope("snapshot", {"foo": "bar"}, 7)
    lines = out.rstrip("\n").split("\n")
    assert lines[0] == "event: snapshot"
    assert lines[1] == "id: 7"
    assert lines[2] == 'data: {"foo": "bar"}'
    assert out.endswith("\n\n")  # SSE record separator


def test_sse_envelope_passes_strings_through_unmodified():
    """A raw string payload (e.g. ``:keepalive``) is emitted as-is."""
    out = ctrl._sse_envelope("snapshot", ":keepalive", 1)
    assert "data: :keepalive\n" in out


def test_sse_envelope_handles_unicode_payload():
    out = ctrl._sse_envelope("node_changed", {"name": "你好"}, 3)
    assert "你好" in out  # ensure_ascii=False


# ──────────────────────────────────────────────────────────────────────────────
# _stream_inspector_events — fast path (already-terminal run)
# ──────────────────────────────────────────────────────────────────────────────


def _drain(stream: Iterator[str]) -> list[str]:
    return list(stream)


def _parse(record: str) -> tuple[str, dict | None]:
    """Pull ``event`` + ``data`` (json-decoded) out of one SSE record."""
    event = None
    data: dict | None = None
    for line in record.rstrip("\n").split("\n"):
        if line.startswith("event: "):
            event = line[len("event: ") :]
        elif line.startswith("data: "):
            try:
                data = json.loads(line[len("data: ") :])
            except json.JSONDecodeError:
                data = None
    assert event is not None
    return event, data


@pytest.fixture
def patch_service(monkeypatch: pytest.MonkeyPatch):
    """Replace ``_service()`` with a MagicMock per-test."""

    fake = MagicMock()
    monkeypatch.setattr(ctrl, "_service", lambda: fake)
    return fake


@pytest.fixture
def patch_subscribe(monkeypatch: pytest.MonkeyPatch):
    """Patch the pub/sub subscribe iterator."""

    def _make(messages: list[InspectorMessage | None]):
        def _subscribe(workflow_run_id: str, *, timeout_seconds: float = 1.0):
            for m in messages:
                if m is None:
                    # heartbeat sentinel
                    yield InspectorMessage(
                        kind="node_changed",
                        workflow_run_id=workflow_run_id,
                        node_id=None,
                        status=None,
                    )
                else:
                    yield m

        monkeypatch.setattr(ctrl.inspector_events, "subscribe", _subscribe)

    return _make


def test_stream_fast_path_when_run_already_terminal(patch_service, app_model, run_id):
    """A run that's already ``succeeded`` should produce ``snapshot`` →
    ``workflow_run_completed`` and close without subscribing to pub/sub."""
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="succeeded")
    records = _drain(ctrl._stream_inspector_events(app_model, run_id))
    assert len(records) == 2
    e0, d0 = _parse(records[0])
    e1, d1 = _parse(records[1])
    assert e0 == "snapshot"
    assert d0 is not None
    assert d0["workflow_run_status"] == "succeeded"
    assert e1 == "workflow_run_completed"
    assert d1 is not None
    assert d1["workflow_run_status"] == "succeeded"


def test_stream_fast_path_each_terminal_status(patch_service, app_model, run_id):
    """All four terminal statuses take the fast-path. Note the enum value for
    partial success is the hyphenated ``partial-succeeded``."""
    for terminal in ("succeeded", "failed", "stopped", "partial-succeeded"):
        patch_service.snapshot_workflow_run.return_value = _snapshot_view(status=terminal)
        records = _drain(ctrl._stream_inspector_events(app_model, run_id))
        events = [_parse(r)[0] for r in records]
        assert events == ["snapshot", "workflow_run_completed"], terminal


def test_stream_initial_404_propagates_before_any_bytes(patch_service, app_model, run_id):
    """``NodeOutputInspectorError`` on the initial snapshot must surface as the
    controller's ``_InspectorNotFound`` exception so Flask returns HTTP 404
    — not a half-streamed SSE body."""
    patch_service.snapshot_workflow_run.side_effect = NodeOutputInspectorError(
        "workflow_run_not_found", "Workflow run not found."
    )
    gen = ctrl._stream_inspector_events(app_model, run_id)
    with pytest.raises(ctrl._InspectorNotFound) as exc:
        next(gen)
    assert exc.value.error_code == "workflow_run_not_found"


# ──────────────────────────────────────────────────────────────────────────────
# _stream_inspector_events — live path (run is running)
# ──────────────────────────────────────────────────────────────────────────────


def test_stream_live_emits_snapshot_then_node_changed_then_completion(
    patch_service, patch_subscribe, app_model, run_id
):
    """Happy path: snapshot → 2× node_changed → workflow_run_completed."""
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")
    patch_service.node_detail.return_value = _node_view(node_id="agent-1")

    msgs = [
        InspectorMessage(kind="node_changed", workflow_run_id=str(run_id), node_id="agent-1", status="running"),
        InspectorMessage(kind="node_changed", workflow_run_id=str(run_id), node_id="agent-1", status="succeeded"),
        InspectorMessage(kind="workflow_completed", workflow_run_id=str(run_id), node_id=None, status="succeeded"),
    ]
    patch_subscribe(msgs)

    events = [_parse(r)[0] for r in _drain(ctrl._stream_inspector_events(app_model, run_id))]
    assert events == ["snapshot", "node_changed", "node_changed", "workflow_run_completed"]
    # node_detail should be called once per delta (not once per heartbeat)
    assert patch_service.node_detail.call_count == 2


def test_stream_emits_heartbeat_after_n_idle_ticks(
    patch_service, patch_subscribe, monkeypatch: pytest.MonkeyPatch, app_model, run_id
):
    """When pub/sub returns the heartbeat sentinel ``_HEARTBEAT_EVERY_TICKS``
    times in a row, the generator emits a ``:keepalive`` SSE comment."""
    monkeypatch.setattr(ctrl, "_HEARTBEAT_EVERY_TICKS", 2)
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")
    patch_service.node_detail.return_value = _node_view()

    # 2 heartbeats → keepalive, then real message + completion.
    patch_subscribe(
        [
            None,
            None,
            InspectorMessage(kind="workflow_completed", workflow_run_id=str(run_id), node_id=None, status="failed"),
        ]
    )
    records = _drain(ctrl._stream_inspector_events(app_model, run_id))
    raw = "".join(records)
    assert ":keepalive\n\n" in raw
    assert "workflow_run_completed" in raw


def test_stream_hard_timeout_force_closes_without_terminal(
    patch_service, patch_subscribe, monkeypatch: pytest.MonkeyPatch, app_model, run_id
):
    """If the engine crashes / drops the terminal event, the generator force-
    closes after ``_STREAM_HARD_TIMEOUT_TICKS`` ticks rather than hanging."""
    monkeypatch.setattr(ctrl, "_STREAM_HARD_TIMEOUT_TICKS", 3)
    monkeypatch.setattr(ctrl, "_HEARTBEAT_EVERY_TICKS", 100)  # avoid keepalive noise
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")

    # 5 heartbeats, no terminal → generator should bail after 3 ticks.
    patch_subscribe([None] * 10)
    records = _drain(ctrl._stream_inspector_events(app_model, run_id))
    events = [_parse(r)[0] for r in records]
    assert events == ["snapshot"]  # only snapshot, then forced close


def test_stream_skips_messages_with_missing_node_id(patch_service, patch_subscribe, app_model, run_id):
    """Defensive: malformed node_changed without node_id is silently dropped."""
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")
    patch_subscribe(
        [
            InspectorMessage(kind="node_changed", workflow_run_id=str(run_id), node_id="", status="running"),
            InspectorMessage(kind="workflow_completed", workflow_run_id=str(run_id), node_id=None, status="succeeded"),
        ]
    )
    events = [_parse(r)[0] for r in _drain(ctrl._stream_inspector_events(app_model, run_id))]
    assert events == ["snapshot", "workflow_run_completed"]
    assert patch_service.node_detail.call_count == 0


def test_stream_skips_node_detail_404_without_breaking_stream(patch_service, patch_subscribe, app_model, run_id):
    """When node_detail 404s mid-stream (node still being persisted), the
    generator just drops that delta and keeps streaming."""
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")
    patch_service.node_detail.side_effect = NodeOutputInspectorError("node_not_in_workflow_run", "transient")
    patch_subscribe(
        [
            InspectorMessage(kind="node_changed", workflow_run_id=str(run_id), node_id="agent-1", status="running"),
            InspectorMessage(kind="workflow_completed", workflow_run_id=str(run_id), node_id=None, status="succeeded"),
        ]
    )
    events = [_parse(r)[0] for r in _drain(ctrl._stream_inspector_events(app_model, run_id))]
    assert events == ["snapshot", "workflow_run_completed"]


def test_stream_emits_error_event_on_node_detail_unexpected_exception(
    patch_service, patch_subscribe, app_model, run_id
):
    """Any non-Inspector exception (DB outage, JSON decode error) becomes a
    user-visible ``error`` SSE record; the stream keeps running."""
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")
    patch_service.node_detail.side_effect = RuntimeError("db gone")
    patch_subscribe(
        [
            InspectorMessage(kind="node_changed", workflow_run_id=str(run_id), node_id="agent-1", status="running"),
            InspectorMessage(kind="workflow_completed", workflow_run_id=str(run_id), node_id=None, status="succeeded"),
        ]
    )
    records = _drain(ctrl._stream_inspector_events(app_model, run_id))
    events = [_parse(r) for r in records]
    kinds = [e for e, _ in events]
    assert kinds == ["snapshot", "error", "workflow_run_completed"]
    err_event, err_data = events[1]
    assert err_data is not None
    assert err_data["node_id"] == "agent-1"
    assert "failed" in err_data["message"]


def test_stream_workflow_completed_status_falls_back_to_unknown(patch_service, patch_subscribe, app_model, run_id):
    """If the pub/sub message arrives with status=None (publish race), the SSE
    payload still carries ``workflow_run_status`` with the ``unknown``
    sentinel so the frontend never sees a missing field."""
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")
    patch_subscribe(
        [InspectorMessage(kind="workflow_completed", workflow_run_id=str(run_id), node_id=None, status=None)]
    )
    records = _drain(ctrl._stream_inspector_events(app_model, run_id))
    e, d = _parse(records[-1])
    assert e == "workflow_run_completed"
    assert d is not None
    assert d["workflow_run_status"] == "unknown"


# ──────────────────────────────────────────────────────────────────────────────
# Resource classes — import-level smoke + service-method delegation
# ──────────────────────────────────────────────────────────────────────────────


def test_resource_classes_are_registered():
    """All 8 Inspector Resource classes must be importable from the module so
    flask-restx can discover them via the namespace decorators."""
    for name in (
        "WorkflowDraftRunNodeOutputsApi",
        "WorkflowDraftRunNodeOutputDetailApi",
        "WorkflowDraftRunNodeOutputPreviewApi",
        "WorkflowDraftRunNodeOutputEventsApi",
        "WorkflowPublishedRunNodeOutputsApi",
        "WorkflowPublishedRunNodeOutputDetailApi",
        "WorkflowPublishedRunNodeOutputPreviewApi",
        "WorkflowPublishedRunNodeOutputEventsApi",
    ):
        assert hasattr(ctrl, name), name


def test_inspector_not_found_preserves_error_code():
    """Sanity: the controller's bespoke 404 wrapper hangs onto the
    Inspector's specific error code rather than collapsing to a generic
    ``not_found``."""
    err = NodeOutputInspectorError("node_not_in_workflow_run", "boom")
    wrapped = ctrl._InspectorNotFound(err)
    assert wrapped.error_code == "node_not_in_workflow_run"
    assert wrapped.code == 404


# ──────────────────────────────────────────────────────────────────────────────
# _serve_* — shared REST handler bodies (covered by both draft + published)
# ──────────────────────────────────────────────────────────────────────────────


def test_serve_snapshot_happy_path(patch_service, app_model, run_id):
    """Returns the snapshot view as JSON-serialisable dict."""
    patch_service.snapshot_workflow_run.return_value = _snapshot_view(status="running")
    result = ctrl._serve_snapshot(app_model, run_id)
    assert isinstance(result, dict)
    assert result["workflow_run_id"] == "00000000-0000-0000-0000-0000000000aa"
    patch_service.snapshot_workflow_run.assert_called_once_with(
        app_model=app_model, workflow_run_id=str(run_id), session=ANY
    )


def test_serve_snapshot_translates_inspector_error_to_404(patch_service, app_model, run_id):
    """``NodeOutputInspectorError`` becomes the controller's 404 wrapper with
    the specific ``error_code`` preserved."""
    patch_service.snapshot_workflow_run.side_effect = NodeOutputInspectorError("workflow_run_not_found", "no such run")
    with pytest.raises(ctrl._InspectorNotFound) as exc:
        ctrl._serve_snapshot(app_model, run_id)
    assert exc.value.error_code == "workflow_run_not_found"


def test_serve_node_detail_happy_path(patch_service, app_model, run_id):
    patch_service.node_detail.return_value = _node_view(node_id="agent-1")
    result = ctrl._serve_node_detail(app_model, run_id, "agent-1")
    assert result["node_id"] == "agent-1"
    patch_service.node_detail.assert_called_once_with(
        app_model=app_model, workflow_run_id=str(run_id), node_id="agent-1", session=ANY
    )


def test_serve_node_detail_translates_inspector_error(patch_service, app_model, run_id):
    patch_service.node_detail.side_effect = NodeOutputInspectorError("node_not_in_workflow_run", "missing")
    with pytest.raises(ctrl._InspectorNotFound) as exc:
        ctrl._serve_node_detail(app_model, run_id, "ghost")
    assert exc.value.error_code == "node_not_in_workflow_run"


def test_serve_output_preview_happy_path(patch_service, app_model, run_id):
    from services.workflow.node_output_inspector_service import (
        DeclaredOutputType,
        OutputPreviewView,
    )

    patch_service.output_preview.return_value = OutputPreviewView(
        node_id="agent-1",
        output_name="text",
        type=DeclaredOutputType.STRING,
        status=NodeOutputStatus.READY,
        value="Hello",
    )
    result = ctrl._serve_output_preview(app_model, run_id, "agent-1", "text")
    assert result["value"] == "Hello"
    assert result["status"] == "ready"
    patch_service.output_preview.assert_called_once_with(
        app_model=app_model,
        workflow_run_id=str(run_id),
        node_id="agent-1",
        output_name="text",
        session=ANY,
    )


def test_serve_output_preview_translates_inspector_error(patch_service, app_model, run_id):
    patch_service.output_preview.side_effect = NodeOutputInspectorError("node_output_not_declared", "no such output")
    with pytest.raises(ctrl._InspectorNotFound) as exc:
        ctrl._serve_output_preview(app_model, run_id, "agent-1", "phantom")
    assert exc.value.error_code == "node_output_not_declared"


# ──────────────────────────────────────────────────────────────────────────────
# Note: the Resource ``.get`` methods themselves (6 REST + 2 SSE) are
# 1-line delegators to the helpers above. They can't be called directly in a
# unit test because their decorator stack (``@setup_required`` /
# ``@login_required`` / ``@account_initialization_required`` /
# ``@get_app_model``) needs a real Flask request context + DB-backed account.
# The integration test in
# ``tests/integration_tests/services/test_node_output_inspector_service.py``
# (and the E2E driver in /tmp/e2e_inspector_sse_published.py) exercise them
# through the HTTP stack.
# ──────────────────────────────────────────────────────────────────────────────
