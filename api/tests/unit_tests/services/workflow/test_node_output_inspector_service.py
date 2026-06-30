"""Unit tests for NodeOutputInspectorService (Stage 4 §8).

The service reads from postgres and resolves agent v2 bindings; this suite
mocks the DB session and binding resolver so we exercise the view-construction
logic without DB / network access.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from core.workflow.file_reference import build_file_reference
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.agent_config_entities import (
    DeclaredArrayItem,
    DeclaredOutputConfig,
    DeclaredOutputType,
)
from models.enums import WorkflowRunTriggeredFrom
from services.workflow.node_output_inspector_service import (
    NodeOutputInspectorError,
    NodeOutputInspectorService,
    NodeOutputStatus,
    NodeStatus,
    _resolve_preview_url,
)

TEST_SESSION: Any = MagicMock()

# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


def _app_model(*, tenant_id: str = "tenant-1", app_id: str = "app-1"):
    return SimpleNamespace(tenant_id=tenant_id, id=app_id)


def _workflow_run(
    *,
    run_id: str = "run-1",
    workflow_id: str = "workflow-1",
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    status: WorkflowExecutionStatus = WorkflowExecutionStatus.RUNNING,
    nodes: list[dict[str, Any]] | None = None,
):
    return SimpleNamespace(
        id=run_id,
        workflow_id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        triggered_from=triggered_from,
        status=status,
        graph=json.dumps({"nodes": nodes or []}),
    )


def _execution(
    *,
    node_id: str,
    node_type: str = "agent",
    title: str = "",
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.SUCCEEDED,
    outputs: dict[str, Any] | None = None,
    execution_metadata: dict[str, Any] | None = None,
    index: int = 1,
    created_at: datetime | None = None,
    finished_at: datetime | None = None,
):
    return SimpleNamespace(
        node_id=node_id,
        node_type=node_type,
        title=title or node_id,
        status=status,
        outputs=json.dumps(outputs) if outputs is not None else None,
        execution_metadata=json.dumps(execution_metadata) if execution_metadata is not None else None,
        index=index,
        created_at=created_at or datetime.now(UTC),
        finished_at=finished_at,
    )


def _agent_v2_node(*, node_id: str = "agent-node-1", title: str = "My Agent") -> dict[str, Any]:
    return {
        "id": node_id,
        "data": {"type": "agent", "version": "2", "title": title},
    }


def _non_agent_node(*, node_id: str = "tool-node-1", node_type: str = "tool", title: str = "Slack") -> dict[str, Any]:
    return {
        "id": node_id,
        "data": {"type": node_type, "title": title},
    }


def _patch_session(
    *,
    workflow_run: SimpleNamespace | None,
    executions: list[SimpleNamespace] | None = None,
):
    """Patch ``db.session`` to return the configured rows.

    Returns a context manager that the test uses with ``with``.
    """
    executions = executions or []
    mock_session = MagicMock()
    mock_session.scalar.return_value = workflow_run
    mock_session.scalars.return_value.all.return_value = executions
    return patch(
        "services.workflow.node_output_inspector_service.db.session",
        mock_session,
    )


def _stub_binding_resolver(*, declared_outputs: list[DeclaredOutputConfig]):
    """Build a fake ``WorkflowAgentBindingResolver`` whose ``.resolve`` returns
    a binding with ``node_job_config_dict.declared_outputs``."""
    binding = SimpleNamespace(
        id="binding-1",
        node_job_config_dict={
            "workflow_prompt": "stub",
            "declared_outputs": [o.model_dump() for o in declared_outputs],
        },
    )
    bundle = SimpleNamespace(binding=binding, agent=None, snapshot=None)
    resolver = MagicMock()
    resolver.resolve.return_value = bundle
    return resolver


def _make_service(declared_outputs: list[DeclaredOutputConfig] | None = None) -> NodeOutputInspectorService:
    return NodeOutputInspectorService(binding_resolver=_stub_binding_resolver(declared_outputs=declared_outputs or []))


# ──────────────────────────────────────────────────────────────────────────────
# 404 paths
# ──────────────────────────────────────────────────────────────────────────────


def test_snapshot_404_when_workflow_run_missing():
    service = _make_service()
    with _patch_session(workflow_run=None):
        with pytest.raises(NodeOutputInspectorError) as exc:
            service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="missing", session=TEST_SESSION)
    assert exc.value.code == "workflow_run_not_found"


def test_snapshot_accepts_published_run_d1_lifted():
    """D-1 was lifted 2026-05-26: any ``triggered_from`` is now accepted."""
    service = _make_service()
    run = _workflow_run(
        nodes=[_agent_v2_node(node_id="agent-1")],
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )
    with _patch_session(workflow_run=run, executions=[]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    assert snapshot.workflow_run_id == "run-1"
    assert [n.node_id for n in snapshot.node_outputs] == ["agent-1"]


def test_snapshot_accepts_webhook_triggered_run():
    """Webhook / schedule / plugin triggers are also published-side."""
    service = _make_service()
    run = _workflow_run(
        nodes=[_agent_v2_node(node_id="agent-1")],
        triggered_from=WorkflowRunTriggeredFrom.WEBHOOK,
    )
    with _patch_session(workflow_run=run, executions=[]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    assert snapshot.workflow_run_id == "run-1"


def test_node_detail_404_when_node_id_absent_from_graph():
    service = _make_service()
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    with _patch_session(workflow_run=run, executions=[]):
        with pytest.raises(NodeOutputInspectorError) as exc:
            service.node_detail(app_model=_app_model(), workflow_run_id="run-1", node_id="ghost", session=TEST_SESSION)
    assert exc.value.code == "node_not_in_workflow_run"


def test_output_preview_404_when_output_name_unknown():
    service = _make_service(
        declared_outputs=[DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(node_id="agent-1", outputs={"text": "hello"})
    with _patch_session(workflow_run=run, executions=[ex]):
        with pytest.raises(NodeOutputInspectorError) as exc:
            service.output_preview(
                app_model=_app_model(),
                workflow_run_id="run-1",
                node_id="agent-1",
                output_name="missing",
                session=TEST_SESSION,
            )
    assert exc.value.code == "node_output_not_declared"


def test_output_preview_404_when_node_id_absent_from_graph():
    service = _make_service()
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    with _patch_session(workflow_run=run, executions=[]):
        with pytest.raises(NodeOutputInspectorError) as exc:
            service.output_preview(
                app_model=_app_model(),
                workflow_run_id="run-1",
                node_id="ghost",
                output_name="report",
                session=TEST_SESSION,
            )
    assert exc.value.code == "node_not_in_workflow_run"


# ──────────────────────────────────────────────────────────────────────────────
# Snapshot happy path
# ──────────────────────────────────────────────────────────────────────────────


def test_snapshot_status_pending_when_node_has_no_execution():
    service = _make_service(
        declared_outputs=[DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    with _patch_session(workflow_run=run, executions=[]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)

    assert len(snapshot.node_outputs) == 1
    node = snapshot.node_outputs[0]
    assert node.node_status == NodeStatus.IDLE
    assert node.outputs[0].status == NodeOutputStatus.PENDING


def test_snapshot_status_running():
    service = _make_service(
        declared_outputs=[DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(node_id="agent-1", status=WorkflowNodeExecutionStatus.RUNNING)
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    assert snapshot.node_outputs[0].node_status == NodeStatus.RUNNING
    assert snapshot.node_outputs[0].outputs[0].status == NodeOutputStatus.RUNNING


def test_snapshot_status_failed_node_marks_all_outputs_failed():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(name="a", type=DeclaredOutputType.STRING),
            DeclaredOutputConfig(name="b", type=DeclaredOutputType.NUMBER),
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(node_id="agent-1", status=WorkflowNodeExecutionStatus.FAILED)
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    statuses = {o.name: o.status for o in snapshot.node_outputs[0].outputs}
    assert statuses == {"a": NodeOutputStatus.FAILED, "b": NodeOutputStatus.FAILED}


def test_snapshot_status_ready_when_outputs_present_and_no_failure_metadata():
    service = _make_service(
        declared_outputs=[DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(node_id="agent-1", outputs={"text": "hello"})
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    output = snapshot.node_outputs[0].outputs[0]
    assert output.status == NodeOutputStatus.READY
    assert output.value_preview == "hello"


def test_snapshot_marks_type_check_failure():
    service = _make_service(
        declared_outputs=[DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(
        node_id="agent-1",
        outputs={"text": "ok"},
        execution_metadata={
            "output_type_check": {
                "passed": False,
                "results": [{"name": "text", "type": "string", "status": "type_check_failed", "reason": "wrong shape"}],
            }
        },
    )
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    output = snapshot.node_outputs[0].outputs[0]
    assert output.status == NodeOutputStatus.TYPE_CHECK_FAILED
    assert output.type_check is not None
    assert output.type_check.passed is False
    assert output.type_check.reason == "wrong shape"


def test_snapshot_marks_output_check_failure_when_type_check_passed():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(
                name="report",
                type=DeclaredOutputType.FILE,
            )
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(
        node_id="agent-1",
        outputs={"report": {"file_id": "550e8400-e29b-41d4-a716-446655440000"}},
        execution_metadata={
            "output_type_check": {"passed": True, "results": [{"name": "report", "status": "ready"}]},
            "output_check": {
                "passed": False,
                "results": [{"name": "report", "status": "failed", "reason": "benchmark mismatch"}],
            },
        },
    )
    with (
        _patch_session(workflow_run=run, executions=[ex]),
        patch(
            "services.workflow.node_output_inspector_service.file_helpers.get_signed_file_url",
            return_value="https://signed.example/x",
        ),
    ):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    output = snapshot.node_outputs[0].outputs[0]
    assert output.status == NodeOutputStatus.OUTPUT_CHECK_FAILED
    assert output.output_check is not None
    assert output.output_check.passed is False
    assert output.output_check.reason == "benchmark mismatch"


def test_snapshot_marks_not_produced_when_declared_output_missing_from_payload():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING),
            DeclaredOutputConfig(name="optional_meta", type=DeclaredOutputType.OBJECT, required=False),
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(node_id="agent-1", outputs={"text": "hi"})  # optional_meta missing
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    statuses = {o.name: o.status for o in snapshot.node_outputs[0].outputs}
    assert statuses == {"text": NodeOutputStatus.READY, "optional_meta": NodeOutputStatus.NOT_PRODUCED}


# ──────────────────────────────────────────────────────────────────────────────
# Non-agent node — outputs inferred from execution payload
# ──────────────────────────────────────────────────────────────────────────────


def test_non_agent_node_outputs_inferred_from_payload_keys():
    service = _make_service()
    run = _workflow_run(nodes=[_non_agent_node(node_id="tool-1", node_type="tool")])
    ex = _execution(
        node_id="tool-1",
        node_type="tool",
        outputs={"message": "sent", "thread_ts": "1234"},
    )
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    output_names = sorted(o.name for o in snapshot.node_outputs[0].outputs)
    assert output_names == ["message", "thread_ts"]
    # All inferred outputs should have ``type=None`` since we don't know the
    # schema yet.
    assert all(o.type is None for o in snapshot.node_outputs[0].outputs)


# ──────────────────────────────────────────────────────────────────────────────
# File preview / signed URL
# ──────────────────────────────────────────────────────────────────────────────


def test_file_output_preview_includes_signed_url():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE),
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    file_payload = {
        "transfer_method": "local_file",
        "reference": build_file_reference(record_id="550e8400-e29b-41d4-a716-446655440000"),
    }
    ex = _execution(node_id="agent-1", outputs={"report": file_payload})
    with (
        _patch_session(workflow_run=run, executions=[ex]),
        patch(
            "services.workflow.node_output_inspector_service._resolve_preview_url",
            return_value="https://signed.example/x.pdf",
        ),
    ):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    preview_value = snapshot.node_outputs[0].outputs[0].value_preview
    assert isinstance(preview_value, dict)
    assert preview_value["preview_url"] == "https://signed.example/x.pdf"
    assert preview_value["reference"] == file_payload["reference"]


def test_file_output_preview_endpoint_returns_full_value_with_signed_url():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE),
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    file_payload = {
        "transfer_method": "tool_file",
        "reference": build_file_reference(record_id="550e8400-e29b-41d4-a716-446655440000"),
    }
    ex = _execution(node_id="agent-1", outputs={"report": file_payload})
    with (
        _patch_session(workflow_run=run, executions=[ex]),
        patch(
            "services.workflow.node_output_inspector_service._resolve_preview_url",
            return_value="https://signed.example/x.pdf",
        ),
    ):
        preview = service.output_preview(
            app_model=_app_model(),
            workflow_run_id="run-1",
            node_id="agent-1",
            output_name="report",
            session=TEST_SESSION,
        )
    assert preview.output_name == "report"
    assert preview.status == NodeOutputStatus.READY
    assert isinstance(preview.value, dict)
    assert preview.value["preview_url"] == "https://signed.example/x.pdf"


def test_resolve_preview_url_uses_standard_file_factory():
    file_payload = {
        "transfer_method": "tool_file",
        "reference": build_file_reference(record_id="550e8400-e29b-41d4-a716-446655440000"),
    }
    file = MagicMock()
    with (
        patch("services.workflow.node_output_inspector_service.DatabaseFileAccessController") as controller_cls,
        patch("services.workflow.node_output_inspector_service.build_from_mapping", return_value=file) as build_file,
        patch(
            "services.workflow.node_output_inspector_service.file_helpers.resolve_file_url",
            return_value="https://signed.example/x.pdf",
        ) as resolve_file_url,
    ):
        assert _resolve_preview_url(file_payload, tenant_id="tenant-1") == "https://signed.example/x.pdf"

    build_file.assert_called_once_with(
        mapping=file_payload,
        tenant_id="tenant-1",
        access_controller=controller_cls.return_value,
    )
    resolve_file_url.assert_called_once_with(file)


def test_array_file_output_preview_includes_signed_urls_for_each_item():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(
                name="files",
                type=DeclaredOutputType.ARRAY,
                array_item=DeclaredArrayItem(type=DeclaredOutputType.FILE),
            ),
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    file_payloads = [
        {
            "transfer_method": "tool_file",
            "reference": build_file_reference(record_id="550e8400-e29b-41d4-a716-446655440001"),
        },
        {
            "transfer_method": "tool_file",
            "reference": build_file_reference(record_id="550e8400-e29b-41d4-a716-446655440002"),
        },
    ]
    ex = _execution(node_id="agent-1", outputs={"files": file_payloads})
    with (
        _patch_session(workflow_run=run, executions=[ex]),
        patch(
            "services.workflow.node_output_inspector_service._resolve_preview_url",
            side_effect=[
                "https://signed.example/1.pdf",
                "https://signed.example/2.pdf",
                "https://signed.example/1-detail.pdf",
                "https://signed.example/2-detail.pdf",
                "https://signed.example/1-full.pdf",
                "https://signed.example/2-full.pdf",
            ],
        ),
    ):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
        preview = service.output_preview(
            app_model=_app_model(),
            workflow_run_id="run-1",
            node_id="agent-1",
            output_name="files",
            session=TEST_SESSION,
        )

    snapshot_value = snapshot.node_outputs[0].outputs[0].value_preview
    assert isinstance(snapshot_value, list)
    assert [item["preview_url"] for item in snapshot_value] == [
        "https://signed.example/1.pdf",
        "https://signed.example/2.pdf",
    ]
    assert isinstance(preview.value, list)
    assert [item["preview_url"] for item in preview.value] == [
        "https://signed.example/1-full.pdf",
        "https://signed.example/2-full.pdf",
    ]


def test_file_output_preview_uses_none_when_signed_url_resolution_fails():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(name="report", type=DeclaredOutputType.FILE),
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    file_payload = {
        "transfer_method": "local_file",
        "reference": build_file_reference(record_id="550e8400-e29b-41d4-a716-446655440000"),
    }
    ex = _execution(node_id="agent-1", outputs={"report": file_payload})
    with (
        _patch_session(workflow_run=run, executions=[ex]),
        patch(
            "services.workflow.node_output_inspector_service._resolve_preview_url",
            side_effect=RuntimeError("boom"),
        ),
    ):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)

    preview_value = snapshot.node_outputs[0].outputs[0].value_preview
    assert isinstance(preview_value, dict)
    assert preview_value["preview_url"] is None


def test_object_output_preview_does_not_augment_canonical_file_mapping_shape():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(name="meta", type=DeclaredOutputType.OBJECT),
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    raw_value = {
        "transfer_method": "tool_file",
        "reference": build_file_reference(record_id="550e8400-e29b-41d4-a716-446655440000"),
    }
    ex = _execution(node_id="agent-1", outputs={"meta": raw_value})
    with (
        _patch_session(workflow_run=run, executions=[ex]),
        patch(
            "services.workflow.node_output_inspector_service._resolve_preview_url",
            return_value="https://signed.example/x.pdf",
        ),
    ):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
        preview = service.output_preview(
            app_model=_app_model(),
            workflow_run_id="run-1",
            node_id="agent-1",
            output_name="meta",
            session=TEST_SESSION,
        )

    assert snapshot.node_outputs[0].outputs[0].value_preview == raw_value
    assert preview.value == raw_value


# ──────────────────────────────────────────────────────────────────────────────
# Retry / metadata
# ──────────────────────────────────────────────────────────────────────────────


def test_retried_count_pulled_from_attempt_metadata():
    service = _make_service(
        declared_outputs=[DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(
        node_id="agent-1",
        outputs={"text": "ok"},
        execution_metadata={"attempt": 2},
    )
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    assert snapshot.node_outputs[0].outputs[0].retried == 2


# ──────────────────────────────────────────────────────────────────────────────
# Latest-execution-per-node grouping
# ──────────────────────────────────────────────────────────────────────────────


def test_keeps_latest_execution_per_node_by_index():
    """When a node has multiple executions (retries / iterations) keep the
    canonical one — the row with the highest ``index``."""
    service = _make_service(
        declared_outputs=[DeclaredOutputConfig(name="text", type=DeclaredOutputType.STRING)],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    older = _execution(node_id="agent-1", outputs={"text": "old"}, index=1)
    newer = _execution(node_id="agent-1", outputs={"text": "new"}, index=5)
    with _patch_session(workflow_run=run, executions=[older, newer]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    assert snapshot.node_outputs[0].outputs[0].value_preview == "new"


# ──────────────────────────────────────────────────────────────────────────────
# Array item declarations round-trip correctly
# ──────────────────────────────────────────────────────────────────────────────


def test_array_typed_output_with_array_item_renders_correctly():
    service = _make_service(
        declared_outputs=[
            DeclaredOutputConfig(
                name="files",
                type=DeclaredOutputType.ARRAY,
                array_item=DeclaredArrayItem(type=DeclaredOutputType.FILE),
            )
        ],
    )
    run = _workflow_run(nodes=[_agent_v2_node(node_id="agent-1")])
    ex = _execution(node_id="agent-1", outputs={"files": []})
    with _patch_session(workflow_run=run, executions=[ex]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    output = snapshot.node_outputs[0].outputs[0]
    assert output.type == DeclaredOutputType.ARRAY


# ──────────────────────────────────────────────────────────────────────────────
# Graph parsing edge cases
# ──────────────────────────────────────────────────────────────────────────────


def test_unparseable_graph_blob_yields_empty_snapshot_not_500():
    service = _make_service()
    run = SimpleNamespace(
        id="run-1",
        workflow_id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        status=WorkflowExecutionStatus.RUNNING,
        graph="{not valid json",
    )
    with _patch_session(workflow_run=run, executions=[]):
        snapshot = service.snapshot_workflow_run(app_model=_app_model(), workflow_run_id="run-1", session=TEST_SESSION)
    assert snapshot.node_outputs == []
