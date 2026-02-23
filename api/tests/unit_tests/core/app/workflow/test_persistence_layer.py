from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.enums import (
    NodeType,
    SystemVariableKey,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from core.workflow.graph_events.graph import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.graph_events.node import (
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events.base import NodeRunResult
from core.workflow.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool
from core.workflow.system_variable import SystemVariable


class _RepoRecorder:
    def __init__(self) -> None:
        self.saved: list[object] = []
        self.saved_exec_data: list[object] = []

    def save(self, entity):
        self.saved.append(entity)

    def save_execution_data(self, entity):
        self.saved_exec_data.append(entity)


def _make_layer(
    system_variable: SystemVariable | None = None,
    *,
    extras: dict | None = None,
    trace_manager: object | None = None,
):
    system_variable = system_variable or SystemVariable(workflow_execution_id="run-id", conversation_id="conv-id")
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(system_variables=system_variable), start_at=0.0)
    read_only_state = ReadOnlyGraphRuntimeStateWrapper(runtime_state)

    application_generate_entity = WorkflowAppGenerateEntity.model_construct(
        task_id="task",
        app_config=SimpleNamespace(app_id="app", tenant_id="tenant"),
        inputs={"foo": "bar"},
        files=[],
        user_id="user",
        stream=False,
        invoke_from=None,
        trace_manager=None,
        workflow_execution_id="run-id",
        extras=extras or {},
        call_depth=0,
    )

    workflow_info = PersistenceWorkflowInfo(
        workflow_id="workflow-id",
        workflow_type=WorkflowType.WORKFLOW,
        version="1",
        graph_data={"nodes": [], "edges": []},
    )

    workflow_execution_repo = _RepoRecorder()
    workflow_node_execution_repo = _RepoRecorder()

    layer = WorkflowPersistenceLayer(
        application_generate_entity=application_generate_entity,
        workflow_info=workflow_info,
        workflow_execution_repository=workflow_execution_repo,
        workflow_node_execution_repository=workflow_node_execution_repo,
        trace_manager=trace_manager,
    )
    layer.initialize(read_only_state, command_channel=None)

    return layer, workflow_execution_repo, workflow_node_execution_repo, runtime_state


class TestWorkflowPersistenceLayer:
    def test_get_execution_id_requires_system_variable(self):
        system_variable = SystemVariable(workflow_execution_id=None)
        layer, _, _, _ = _make_layer(system_variable)

        with pytest.raises(ValueError, match="workflow_execution_id must be provided"):
            layer._get_execution_id()

    def test_prepare_workflow_inputs_excludes_conversation_id(self, monkeypatch):
        layer, _, _, _ = _make_layer()

        monkeypatch.setattr(
            "core.workflow.workflow_entry.WorkflowEntry.handle_special_values",
            lambda inputs: inputs,
        )

        inputs = layer._prepare_workflow_inputs()

        assert "sys.conversation_id" not in inputs
        assert inputs[f"sys.{SystemVariableKey.WORKFLOW_EXECUTION_ID.value}"] == "run-id"

    def test_fail_running_node_executions_marks_failed(self):
        layer, _, node_repo, _ = _make_layer()

        execution = WorkflowNodeExecution(
            id="exec-id",
            workflow_id="workflow-id",
            workflow_execution_id="run-id",
            index=1,
            node_id="node",
            node_type=NodeType.START,
            title="Start",
            created_at=datetime.now(UTC),
        )
        layer._node_execution_cache[execution.id] = execution

        layer._fail_running_node_executions(error_message="boom")

        assert execution.status == WorkflowNodeExecutionStatus.FAILED
        assert node_repo.saved

    def test_handle_graph_run_started_saves_execution(self):
        layer, exec_repo, _, _ = _make_layer()

        layer._handle_graph_run_started()

        assert exec_repo.saved

    def test_handle_graph_run_succeeded_updates_execution(self):
        layer, exec_repo, _, runtime_state = _make_layer()
        layer._handle_graph_run_started()
        runtime_state.total_tokens = 3
        runtime_state.node_run_steps = 2
        runtime_state.outputs = {"out": "v"}

        layer._handle_graph_run_succeeded(GraphRunSucceededEvent(outputs={"ok": True}))

        saved = exec_repo.saved[-1]
        assert saved.status == WorkflowExecutionStatus.SUCCEEDED
        assert saved.total_tokens == 3
        assert saved.total_steps == 2

    def test_handle_graph_run_partial_succeeded_updates_execution(self):
        layer, exec_repo, _, runtime_state = _make_layer()
        layer._handle_graph_run_started()
        runtime_state.total_tokens = 5
        runtime_state.node_run_steps = 4
        runtime_state._graph_execution = SimpleNamespace(exceptions_count=2)

        layer._handle_graph_run_partial_succeeded(
            GraphRunPartialSucceededEvent(outputs={"ok": True}, exceptions_count=2)
        )

        saved = exec_repo.saved[-1]
        assert saved.status == WorkflowExecutionStatus.PARTIAL_SUCCEEDED
        assert saved.exceptions_count == 2
        assert saved.total_tokens == 5

    def test_handle_graph_run_failed_marks_nodes_and_enqueues_trace(self):
        trace_tasks: list[object] = []
        trace_manager = SimpleNamespace(user_id="user", add_trace_task=lambda task: trace_tasks.append(task))
        layer, exec_repo, node_repo, _ = _make_layer(extras={"external_trace_id": "trace"}, trace_manager=trace_manager)
        layer._handle_graph_run_started()

        running = WorkflowNodeExecution(
            id="node-exec",
            workflow_id="workflow-id",
            workflow_execution_id="run-id",
            index=1,
            node_id="node",
            node_type=NodeType.START,
            title="Start",
            created_at=datetime.now(UTC),
        )
        layer._node_execution_cache[running.id] = running

        layer._handle_graph_run_failed(GraphRunFailedEvent(error="boom", exceptions_count=1))

        assert node_repo.saved
        assert exec_repo.saved[-1].status == WorkflowExecutionStatus.FAILED
        assert trace_tasks

    def test_handle_graph_run_aborted_sets_status(self):
        layer, exec_repo, _, _ = _make_layer()
        layer._handle_graph_run_started()

        layer._handle_graph_run_aborted(GraphRunAbortedEvent(reason=None, outputs={}))

        saved = exec_repo.saved[-1]
        assert saved.status == WorkflowExecutionStatus.STOPPED
        assert saved.error_message

    def test_handle_graph_run_paused_updates_outputs(self):
        layer, exec_repo, _, runtime_state = _make_layer()
        layer._handle_graph_run_started()
        runtime_state.total_tokens = 7
        runtime_state.node_run_steps = 5

        layer._handle_graph_run_paused(GraphRunPausedEvent(outputs={"pause": True}))

        saved = exec_repo.saved[-1]
        assert saved.status == WorkflowExecutionStatus.PAUSED
        assert saved.outputs == {"pause": True}
        assert saved.finished_at is None

    def test_handle_node_started_and_retry(self):
        layer, _, node_repo, _ = _make_layer()
        layer._handle_graph_run_started()

        start_event = NodeRunStartedEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.START,
            node_title="Start",
            start_at=datetime.now(UTC),
            predecessor_node_id="prev",
            in_iteration_id="iter",
            in_loop_id="loop",
        )
        layer._handle_node_started(start_event)

        assert node_repo.saved
        assert "exec" in layer._node_execution_cache
        assert layer._node_snapshots["exec"].node_id == "node"

        retry_event = NodeRunRetryEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.START,
            node_title="Start",
            start_at=datetime.now(UTC),
            error="retry",
            retry_index=1,
        )
        layer._handle_node_retry(retry_event)
        assert node_repo.saved_exec_data

    def test_handle_node_result_events_update_execution(self):
        layer, _, node_repo, _ = _make_layer()
        layer._handle_graph_run_started()

        start_event = NodeRunStartedEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            start_at=datetime.now(UTC),
        )
        layer._handle_node_started(start_event)

        result = NodeRunResult(inputs={"a": 1}, process_data={"b": 2}, outputs={"c": 3}, metadata={})
        success_event = NodeRunSucceededEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            start_at=datetime.now(UTC),
            node_run_result=result,
        )
        layer._handle_node_succeeded(success_event)

        failed_event = NodeRunFailedEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            start_at=datetime.now(UTC),
            error="boom",
            node_run_result=result,
        )
        layer._handle_node_failed(failed_event)

        exception_event = NodeRunExceptionEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            start_at=datetime.now(UTC),
            error="err",
            node_run_result=result,
        )
        layer._handle_node_exception(exception_event)

        assert node_repo.saved_exec_data

    def test_handle_node_pause_requested_skips_outputs(self):
        layer, _, _, _ = _make_layer()
        layer._handle_graph_run_started()
        start_event = NodeRunStartedEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            node_title="LLM",
            start_at=datetime.now(UTC),
        )
        layer._handle_node_started(start_event)

        domain_execution = layer._node_execution_cache["exec"]
        domain_execution.inputs = {"old": True}

        result = NodeRunResult(inputs={"new": True}, outputs={"out": 1}, process_data={"p": 1}, metadata={})
        pause_event = NodeRunPauseRequestedEvent(
            id="exec",
            node_id="node",
            node_type=NodeType.LLM,
            reason=SchedulingPause(message="pause"),
            node_run_result=result,
        )
        layer._handle_node_pause_requested(pause_event)

        assert domain_execution.status == WorkflowNodeExecutionStatus.PAUSED
        assert domain_execution.inputs == {"old": True}

    def test_get_node_execution_raises_for_missing(self):
        layer, _, _, _ = _make_layer()
        with pytest.raises(ValueError, match="Node execution not found"):
            layer._get_node_execution("missing")

    def test_next_node_sequence_increments(self):
        layer, _, _, _ = _make_layer()
        assert layer._next_node_sequence() == 1
        assert layer._next_node_sequence() == 2

    def test_enqueue_trace_task_skips_when_disabled(self):
        trace_tasks: list[object] = []
        layer, exec_repo, _, _ = _make_layer()
        layer._handle_graph_run_started()
        layer._handle_graph_run_succeeded(GraphRunSucceededEvent(outputs={"ok": True}))
        assert exec_repo.saved
        assert not trace_tasks
