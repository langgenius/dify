"""End-to-end tests for ``NodeOutputInspectorService`` (Stage 4 §8 / ENG-373).

These integration tests exercise the service against a real Postgres
(``dify-db-1``) — same pattern as :mod:`test_remove_app_and_related_data_task`:
seed rows via ``session_factory.create_session()`` with explicit commits,
exercise the service, clean up by ID at teardown.

Coverage:
1. Snapshot for a draft run with one agent v2 node + one tool node
2. Type-check failure visible in snapshot
3. Output-check failure visible in snapshot
4. Published run returns ``published_run_inspector_not_implemented``
5. Cross-tenant access returns ``workflow_run_not_found``
6. File output preview endpoint returns full value with signed URL
7. ``node_detail`` path serves a single node view
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Generator
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import delete

from core.db.session_factory import session_factory
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from services.workflow.node_output_inspector_service import (
    NodeOutputInspectorError,
    NodeOutputInspectorService,
    NodeOutputStatus,
    NodeStatus,
)


@pytest.fixture
def fake_app_model() -> SimpleNamespace:
    """Lightweight stand-in for the ``App`` model that the service consumes.

    ``App`` is only read for ``id`` and ``tenant_id``; the service does not
    poke at any ORM relationship so a SimpleNamespace is enough — and it
    keeps us free of needing the ``apps`` row to actually exist (which would
    drag in Account / Tenant setup).
    """
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
    )


def _make_workflow_run(
    *,
    app_id: str,
    tenant_id: str,
    triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    status: WorkflowExecutionStatus = WorkflowExecutionStatus.RUNNING,
    graph: dict[str, Any] | None = None,
) -> WorkflowRun:
    """Build a ``WorkflowRun`` row with all required fields populated."""
    return WorkflowRun(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=str(uuid.uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=triggered_from,
        version="draft",
        graph=json.dumps(graph or {"nodes": []}),
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid.uuid4()),
    )


def _make_execution(
    *,
    app_id: str,
    tenant_id: str,
    workflow_id: str,
    workflow_run_id: str,
    node_id: str,
    node_type: str = "agent",
    title: str = "",
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.SUCCEEDED,
    outputs: dict[str, Any] | None = None,
    execution_metadata: dict[str, Any] | None = None,
    index: int = 1,
) -> WorkflowNodeExecutionModel:
    """Build a ``WorkflowNodeExecutionModel`` row with all required fields."""
    return WorkflowNodeExecutionModel(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=workflow_run_id,
        index=index,
        node_id=node_id,
        node_type=node_type,
        title=title or node_id,
        status=status,
        outputs=json.dumps(outputs) if outputs is not None else None,
        execution_metadata=json.dumps(execution_metadata) if execution_metadata is not None else None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid.uuid4()),
        created_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
    )


@pytest.fixture
def seeded_run(
    flask_req_ctx, fake_app_model: SimpleNamespace
) -> Generator[tuple[SimpleNamespace, WorkflowRun, list[WorkflowNodeExecutionModel]], None, None]:
    """Seed one debug ``WorkflowRun`` + 2 node executions in real Postgres.

    Yields ``(app_model, workflow_run, executions)``. Cleans both rows up at
    teardown via direct ``DELETE`` so a failed test never leaves debris.
    """
    graph = {
        "nodes": [
            {
                "id": "agent-node-1",
                "data": {"type": "agent", "version": "2", "title": "My Agent"},
            },
            {
                "id": "tool-node-1",
                "data": {"type": "tool", "title": "Slack"},
            },
        ]
    }
    workflow_run = _make_workflow_run(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        graph=graph,
    )
    agent_execution = _make_execution(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        node_id="agent-node-1",
        node_type="agent",
        outputs={"text": "hello world"},
        execution_metadata={
            "output_type_check": {
                "passed": True,
                "results": [{"name": "text", "type": "string", "status": "ready"}],
            },
            "attempt": 0,
        },
        index=1,
    )
    tool_execution = _make_execution(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        node_id="tool-node-1",
        node_type="tool",
        outputs={"message": "sent", "ok": True},
        index=2,
    )

    with session_factory.create_session() as session:
        session.add(workflow_run)
        session.add(agent_execution)
        session.add(tool_execution)
        session.commit()
        run_id = workflow_run.id
        execution_ids = [agent_execution.id, tool_execution.id]

    try:
        yield fake_app_model, workflow_run, [agent_execution, tool_execution]
    finally:
        with session_factory.create_session() as session:
            session.execute(delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id.in_(execution_ids)))
            session.execute(delete(WorkflowRun).where(WorkflowRun.id == run_id))
            session.commit()


# ──────────────────────────────────────────────────────────────────────────────
# Stub binding resolver — declared outputs for the agent v2 node
# ──────────────────────────────────────────────────────────────────────────────


def _stub_resolver(declared_outputs_payload: list[dict[str, Any]]):
    """Return a stand-in binding resolver whose ``.resolve`` always returns
    one bundle with the supplied declared_outputs.

    The real resolver hits ``workflow_agent_node_bindings``; we skip that
    table here so the Inspector can be tested without binding-row setup.
    """
    binding = SimpleNamespace(
        id="binding-1",
        node_job_config_dict={
            "workflow_prompt": "stub",
            "declared_outputs": declared_outputs_payload,
        },
    )
    bundle = SimpleNamespace(binding=binding, agent=None, snapshot=None)

    class _Resolver:
        def resolve(self, **_: Any):
            return bundle

    return _Resolver()


def _snapshot_workflow_run(service: NodeOutputInspectorService, *, app_model: Any, workflow_run_id: str):
    with session_factory.create_session() as session:
        return service.snapshot_workflow_run(app_model=app_model, workflow_run_id=workflow_run_id, session=session)


def _node_detail(service: NodeOutputInspectorService, *, app_model: Any, workflow_run_id: str, node_id: str):
    with session_factory.create_session() as session:
        return service.node_detail(
            app_model=app_model, workflow_run_id=workflow_run_id, node_id=node_id, session=session
        )


def _output_preview(
    service: NodeOutputInspectorService,
    *,
    app_model: Any,
    workflow_run_id: str,
    node_id: str,
    output_name: str,
):
    with session_factory.create_session() as session:
        return service.output_preview(
            app_model=app_model,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            output_name=output_name,
            session=session,
        )


# ──────────────────────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────────────────────


def test_snapshot_returns_agent_v2_declared_outputs_with_status_ready(seeded_run):
    """Happy path: agent v2 node + tool node both render, statuses come from
    real ``WorkflowRun`` + ``WorkflowNodeExecutionModel`` rows."""
    app_model, workflow_run, _ = seeded_run
    service = NodeOutputInspectorService(binding_resolver=_stub_resolver([{"name": "text", "type": "string"}]))
    snapshot = _snapshot_workflow_run(
        service,
        app_model=app_model,
        workflow_run_id=workflow_run.id,
    )

    assert snapshot.workflow_run_id == workflow_run.id
    assert snapshot.workflow_run_status == WorkflowExecutionStatus.RUNNING

    by_node = {n.node_id: n for n in snapshot.node_outputs}

    agent_view = by_node["agent-node-1"]
    assert agent_view.node_status == NodeStatus.READY
    assert agent_view.outputs[0].name == "text"
    assert agent_view.outputs[0].status == NodeOutputStatus.READY
    assert agent_view.outputs[0].value_preview == "hello world"

    tool_view = by_node["tool-node-1"]
    # Tool node's declared outputs are *inferred* from the produced payload.
    output_names = sorted(o.name for o in tool_view.outputs)
    assert output_names == ["message", "ok"]
    assert all(o.type is None for o in tool_view.outputs)


def test_snapshot_404s_for_missing_run(fake_app_model):
    """Service raises ``workflow_run_not_found`` when the row doesn't exist."""
    service = NodeOutputInspectorService(binding_resolver=_stub_resolver([]))
    with pytest.raises(NodeOutputInspectorError) as exc:
        _snapshot_workflow_run(service, app_model=fake_app_model, workflow_run_id=str(uuid.uuid4()))
    assert exc.value.code == "workflow_run_not_found"


def test_snapshot_404s_for_cross_tenant_access(seeded_run):
    """A wrong-tenant app_model must not see another tenant's run."""
    _, workflow_run, _ = seeded_run
    intruder = SimpleNamespace(id=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()))
    service = NodeOutputInspectorService(binding_resolver=_stub_resolver([]))
    with pytest.raises(NodeOutputInspectorError) as exc:
        _snapshot_workflow_run(service, app_model=intruder, workflow_run_id=workflow_run.id)
    assert exc.value.code == "workflow_run_not_found"


def test_snapshot_404s_for_published_run_per_decision_d1(flask_req_ctx, fake_app_model):
    """Decision D-1: published / app-run Inspector deferred to stage 4.1."""
    workflow_run = _make_workflow_run(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        graph={"nodes": []},
    )
    with session_factory.create_session() as session:
        session.add(workflow_run)
        session.commit()
        run_id = workflow_run.id

    try:
        service = NodeOutputInspectorService(binding_resolver=_stub_resolver([]))
        with pytest.raises(NodeOutputInspectorError) as exc:
            _snapshot_workflow_run(service, app_model=fake_app_model, workflow_run_id=run_id)
        assert exc.value.code == "published_run_inspector_not_implemented"
    finally:
        with session_factory.create_session() as session:
            session.execute(delete(WorkflowRun).where(WorkflowRun.id == run_id))
            session.commit()


def test_snapshot_surfaces_type_check_failure_from_metadata(flask_req_ctx, fake_app_model):
    """Per-output ``TYPE_CHECK_FAILED`` derived from the metadata blob the
    Stage 4 §5 stack records on the execution row."""
    graph = {"nodes": [{"id": "agent-1", "data": {"type": "agent", "version": "2"}}]}
    workflow_run = _make_workflow_run(app_id=fake_app_model.id, tenant_id=fake_app_model.tenant_id, graph=graph)
    execution = _make_execution(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        node_id="agent-1",
        outputs={"summary": 123},  # int despite declared string
        execution_metadata={
            "output_type_check": {
                "passed": False,
                "results": [
                    {
                        "name": "summary",
                        "type": "string",
                        "status": "type_check_failed",
                        "reason": "expected string, got int",
                    }
                ],
            }
        },
    )
    with session_factory.create_session() as session:
        session.add(workflow_run)
        session.add(execution)
        session.commit()
        run_id, execution_id = workflow_run.id, execution.id

    try:
        service = NodeOutputInspectorService(binding_resolver=_stub_resolver([{"name": "summary", "type": "string"}]))
        snapshot = _snapshot_workflow_run(service, app_model=fake_app_model, workflow_run_id=run_id)
        output = snapshot.node_outputs[0].outputs[0]
        assert output.status == NodeOutputStatus.TYPE_CHECK_FAILED
        assert output.type_check is not None
        assert output.type_check.passed is False
        assert output.type_check.reason == "expected string, got int"
    finally:
        with session_factory.create_session() as session:
            session.execute(delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution_id))
            session.execute(delete(WorkflowRun).where(WorkflowRun.id == run_id))
            session.commit()


def test_snapshot_surfaces_output_check_failure_from_metadata(flask_req_ctx, fake_app_model):
    """When ``output_type_check.passed`` but ``output_check.passed=False``, the
    output is flagged ``OUTPUT_CHECK_FAILED``."""
    graph = {"nodes": [{"id": "agent-1", "data": {"type": "agent", "version": "2"}}]}
    workflow_run = _make_workflow_run(app_id=fake_app_model.id, tenant_id=fake_app_model.tenant_id, graph=graph)
    execution = _make_execution(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
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
    with session_factory.create_session() as session:
        session.add(workflow_run)
        session.add(execution)
        session.commit()
        run_id, execution_id = workflow_run.id, execution.id

    try:
        service = NodeOutputInspectorService(binding_resolver=_stub_resolver([{"name": "report", "type": "file"}]))
        # Stub signed-URL so we don't depend on the workflow file runtime being
        # bound (it isn't, in this minimal flask_req_ctx).
        with patch(
            "services.workflow.node_output_inspector_service.file_helpers.get_signed_file_url",
            return_value="https://signed.example/report",
        ):
            snapshot = _snapshot_workflow_run(service, app_model=fake_app_model, workflow_run_id=run_id)
        output = snapshot.node_outputs[0].outputs[0]
        assert output.status == NodeOutputStatus.OUTPUT_CHECK_FAILED
        assert output.output_check is not None
        assert output.output_check.passed is False
        assert output.output_check.reason == "benchmark mismatch"
    finally:
        with session_factory.create_session() as session:
            session.execute(delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == execution_id))
            session.execute(delete(WorkflowRun).where(WorkflowRun.id == run_id))
            session.commit()


def test_node_detail_serves_one_node(seeded_run):
    app_model, workflow_run, _ = seeded_run
    service = NodeOutputInspectorService(binding_resolver=_stub_resolver([{"name": "text", "type": "string"}]))
    view = _node_detail(
        service,
        app_model=app_model,
        workflow_run_id=workflow_run.id,
        node_id="agent-node-1",
    )
    assert view.node_id == "agent-node-1"
    assert view.outputs[0].name == "text"


def test_output_preview_for_file_renders_signed_url(seeded_run, fake_app_model):
    """``preview`` returns the full value with signed_url for file refs."""
    # Replace the seeded agent execution's output with a file ref.
    _, workflow_run, executions = seeded_run
    agent_execution = executions[0]
    with session_factory.create_session() as session:
        # Re-bind the persisted row so we can mutate + commit.
        from sqlalchemy import select

        row = session.scalar(
            select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == agent_execution.id)
        )
        assert row is not None
        row.outputs = json.dumps({"text": {"file_id": "550e8400-e29b-41d4-a716-446655440000", "filename": "x.pdf"}})
        session.commit()

    service = NodeOutputInspectorService(binding_resolver=_stub_resolver([{"name": "text", "type": "file"}]))
    with patch(
        "services.workflow.node_output_inspector_service.file_helpers.get_signed_file_url",
        return_value="https://signed.example/x.pdf",
    ):
        preview = _output_preview(
            service,
            app_model=fake_app_model,
            workflow_run_id=workflow_run.id,
            node_id="agent-node-1",
            output_name="text",
        )
    assert preview.output_name == "text"
    assert isinstance(preview.value, dict)
    assert preview.value["preview_url"] == "https://signed.example/x.pdf"
    assert preview.value["filename"] == "x.pdf"


def test_keeps_latest_execution_per_node_by_index(flask_req_ctx, fake_app_model):
    """Multiple executions for the same node_id → service keeps the highest
    ``index`` (matches the agent_v2 retry pattern that re-emits node
    executions)."""
    graph = {"nodes": [{"id": "agent-1", "data": {"type": "agent", "version": "2"}}]}
    workflow_run = _make_workflow_run(app_id=fake_app_model.id, tenant_id=fake_app_model.tenant_id, graph=graph)
    older = _make_execution(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        node_id="agent-1",
        outputs={"text": "first attempt"},
        index=1,
    )
    newer = _make_execution(
        app_id=fake_app_model.id,
        tenant_id=fake_app_model.tenant_id,
        workflow_id=workflow_run.workflow_id,
        workflow_run_id=workflow_run.id,
        node_id="agent-1",
        outputs={"text": "second attempt"},
        index=5,
    )
    with session_factory.create_session() as session:
        session.add(workflow_run)
        session.add(older)
        session.add(newer)
        session.commit()
        run_id, ex_ids = workflow_run.id, [older.id, newer.id]

    try:
        service = NodeOutputInspectorService(binding_resolver=_stub_resolver([{"name": "text", "type": "string"}]))
        snapshot = _snapshot_workflow_run(service, app_model=fake_app_model, workflow_run_id=run_id)
        assert snapshot.node_outputs[0].outputs[0].value_preview == "second attempt"
    finally:
        with session_factory.create_session() as session:
            session.execute(delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id.in_(ex_ids)))
            session.execute(delete(WorkflowRun).where(WorkflowRun.id == run_id))
            session.commit()
