from datetime import UTC, datetime
from unittest.mock import Mock

import pytest

from core.app.workflow.layers.persistence import (
    PersistenceWorkflowInfo,
    WorkflowPersistenceLayer,
    _NodeRuntimeSnapshot,
)
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus, WorkflowType
from graphon.graph_events import GraphRunFailedEvent, GraphRunSucceededEvent
from graphon.node_events import NodeRunResult


def _build_layer(secret_values: tuple[str, ...] = ()) -> WorkflowPersistenceLayer:
    application_generate_entity = Mock()
    application_generate_entity.inputs = {}

    return WorkflowPersistenceLayer(
        application_generate_entity=application_generate_entity,
        workflow_info=PersistenceWorkflowInfo(
            workflow_id="workflow-id",
            workflow_type=WorkflowType.WORKFLOW,
            version="1",
            graph_data={},
            secret_values=secret_values,
        ),
        workflow_execution_repository=Mock(),
        workflow_node_execution_repository=Mock(),
    )


def test_update_node_execution_prefers_event_finished_at(monkeypatch: pytest.MonkeyPatch) -> None:
    layer = _build_layer()
    node_execution = Mock()
    node_execution.id = "node-exec-1"
    node_execution.created_at = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    node_execution.update_from_mapping = Mock()

    layer._node_snapshots[node_execution.id] = _NodeRuntimeSnapshot(
        node_id="node-id",
        title="LLM",
        predecessor_node_id=None,
        iteration_id="iter-1",
        loop_id=None,
        created_at=node_execution.created_at,
    )

    event_finished_at = datetime(2024, 1, 1, 0, 0, 2, tzinfo=UTC).replace(tzinfo=None)
    delayed_processing_time = datetime(2024, 1, 1, 0, 0, 10, tzinfo=UTC).replace(tzinfo=None)
    monkeypatch.setattr("core.app.workflow.layers.persistence.naive_utc_now", lambda: delayed_processing_time)

    layer._update_node_execution(
        node_execution,
        NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
        WorkflowNodeExecutionStatus.SUCCEEDED,
        finished_at=event_finished_at,
    )

    assert node_execution.finished_at == event_finished_at
    assert node_execution.elapsed_time == 2.0


def test_update_node_execution_projects_start_outputs() -> None:
    layer = _build_layer()
    node_execution = Mock()
    node_execution.id = "node-exec-2"
    node_execution.node_type = BuiltinNodeTypes.START
    node_execution.created_at = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    node_execution.update_from_mapping = Mock()

    layer._node_snapshots[node_execution.id] = _NodeRuntimeSnapshot(
        node_id="start",
        title="Start",
        predecessor_node_id=None,
        iteration_id=None,
        loop_id=None,
        created_at=node_execution.created_at,
    )

    layer._update_node_execution(
        node_execution,
        NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"question": "hello"},
            outputs={
                "question": "hello",
                "sys.query": "hello",
                "env.API_KEY": "secret",
            },
        ),
        WorkflowNodeExecutionStatus.SUCCEEDED,
    )

    node_execution.update_from_mapping.assert_called_once_with(
        inputs={"question": "hello"},
        process_data={},
        outputs={"question": "hello"},
        metadata={},
    )


def test_update_node_execution_redacts_secret_values() -> None:
    from core.workflow.secret_scrub import SECRET_PLACEHOLDER

    layer = _build_layer(secret_values=("supersecretvalue123",))
    node_execution = Mock()
    node_execution.id = "node-exec-secret"
    node_execution.node_type = BuiltinNodeTypes.START
    node_execution.created_at = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    node_execution.update_from_mapping = Mock()

    layer._node_snapshots[node_execution.id] = _NodeRuntimeSnapshot(
        node_id="start",
        title="Start",
        predecessor_node_id=None,
        iteration_id=None,
        loop_id=None,
        created_at=node_execution.created_at,
    )

    layer._update_node_execution(
        node_execution,
        NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={"api_key": "Bearer supersecretvalue123"},
            outputs={"question": "hello"},
            process_data={"token": "supersecretvalue123"},
        ),
        WorkflowNodeExecutionStatus.SUCCEEDED,
    )

    kwargs = node_execution.update_from_mapping.call_args.kwargs
    assert kwargs["inputs"] == {"api_key": f"Bearer {SECRET_PLACEHOLDER}"}
    assert kwargs["process_data"] == {"token": SECRET_PLACEHOLDER}
    assert "supersecretvalue123" not in str(kwargs)


def test_handle_graph_run_succeeded_redacts_outputs(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.workflow.secret_scrub import SECRET_PLACEHOLDER

    layer = _build_layer(secret_values=("supersecretvalue123",))

    # Provide a real-attribute-storing mock as the current workflow execution.
    execution = Mock()
    layer._workflow_execution = execution

    # Stub out _populate_completion_statistics — it accesses graph_runtime_state,
    # which requires a bound GraphEngine; irrelevant to the redaction assertion.
    layer._populate_completion_statistics = Mock()

    # Silence the inspector side-effect; _enqueue_trace_task is already a no-op
    # because trace_manager defaults to None in _build_layer.
    monkeypatch.setattr(
        "core.app.workflow.layers.persistence._inspector_publish_workflow_completed",
        Mock(),
    )

    event = GraphRunSucceededEvent(outputs={"result": "Bearer supersecretvalue123"})
    layer._handle_graph_run_succeeded(event)

    assert execution.outputs == {"result": f"Bearer {SECRET_PLACEHOLDER}"}
    assert "supersecretvalue123" not in str(execution.outputs)


def test_update_node_execution_redacts_error_field() -> None:
    """Secrets in node error strings must be redacted before persistence."""
    from core.workflow.secret_scrub import SECRET_PLACEHOLDER

    layer = _build_layer(secret_values=("supersecretvalue123",))
    node_execution = Mock()
    node_execution.id = "node-exec-error"
    node_execution.node_type = BuiltinNodeTypes.START
    node_execution.created_at = datetime(2024, 1, 1, 0, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    node_execution.update_from_mapping = Mock()

    layer._node_snapshots[node_execution.id] = _NodeRuntimeSnapshot(
        node_id="code",
        title="Code",
        predecessor_node_id=None,
        iteration_id=None,
        loop_id=None,
        created_at=node_execution.created_at,
    )

    layer._update_node_execution(
        node_execution,
        NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED),
        WorkflowNodeExecutionStatus.FAILED,
        error="API call failed: token=supersecretvalue123 rejected",
    )

    assert SECRET_PLACEHOLDER in node_execution.error
    assert "supersecretvalue123" not in node_execution.error


def test_handle_graph_run_failed_redacts_error_message(monkeypatch: pytest.MonkeyPatch) -> None:
    """Secrets in workflow-level error messages must be redacted before persistence."""
    from core.workflow.secret_scrub import SECRET_PLACEHOLDER

    layer = _build_layer(secret_values=("supersecretvalue123",))

    execution = Mock()
    layer._workflow_execution = execution

    layer._populate_completion_statistics = Mock()
    # Stub _fail_running_node_executions to avoid iterating empty cache with redact calls.
    layer._fail_running_node_executions = Mock()

    monkeypatch.setattr(
        "core.app.workflow.layers.persistence._inspector_publish_workflow_completed",
        Mock(),
    )

    event = GraphRunFailedEvent(error="Upstream error: key=supersecretvalue123 invalid")
    layer._handle_graph_run_failed(event)

    assert SECRET_PLACEHOLDER in execution.error_message
    assert "supersecretvalue123" not in execution.error_message
