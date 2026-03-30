from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from graphon.entities import WorkflowNodeExecution
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from graphon.graph_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.node_events import NodeRunResult
from graphon.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool

from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.workflow.system_variables import SystemVariableKey, build_system_variables


class _RepoRecorder:
    def __init__(self) -> None:
        self.saved: list[object] = []
        self.saved_exec_data: list[object] = []

    def save(self, entity):
        self.saved.append(entity)

    def save_execution_data(self, entity):
        self.saved_exec_data.append(entity)


def _naive_utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _make_layer(
    system_variables: list | None = None,
    *,
    extras: dict | None = None,
    trace_manager: object | None = None,
):
    system_variables = system_variables or build_system_variables(
        workflow_execution_id="run-id",
        conversation_id="conv-id",
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(system_variables=system_variables), start_at=0.0)
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
    def test_on_graph_start_resets_state(self):
        layer, _, _, _ = _make_layer()
        layer._workflow_execution = object()
        layer._node_execution_cache["cached"] = object()
        layer._node_snapshots["cached"] = object()
        layer._node_sequence = 9

        layer.on_graph_start()

        assert layer._workflow_execution is None
        assert layer._node_execution_cache == {}
        assert layer._node_snapshots == {}
        assert layer._node_sequence == 0

    def test_get_execution_id_requires_system_variable(self):
        layer, _, _, _ = _make_layer(build_system_variables())

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
            node_type=BuiltinNodeTypes.START,
            title="Start",
            created_at=_naive_utc_now(),
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
            node_type=BuiltinNodeTypes.START,
            title="Start",
            created_at=_naive_utc_now(),
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
            node_type=BuiltinNodeTypes.START,
            node_title="Start",
            start_at=_naive_utc_now(),
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
            node_type=BuiltinNodeTypes.START,
            node_title="Start",
            start_at=_naive_utc_now(),
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
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=_naive_utc_now(),
        )
        layer._handle_node_started(start_event)

        result = NodeRunResult(inputs={"a": 1}, process_data={"b": 2}, outputs={"c": 3}, metadata={})
        success_event = NodeRunSucceededEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=_naive_utc_now(),
            node_run_result=result,
        )
        layer._handle_node_succeeded(success_event)

        failed_event = NodeRunFailedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=_naive_utc_now(),
            error="boom",
            node_run_result=result,
        )
        layer._handle_node_failed(failed_event)

        exception_event = NodeRunExceptionEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=_naive_utc_now(),
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
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=_naive_utc_now(),
        )
        layer._handle_node_started(start_event)

        domain_execution = layer._node_execution_cache["exec"]
        domain_execution.inputs = {"old": True}

        result = NodeRunResult(inputs={"new": True}, outputs={"out": 1}, process_data={"p": 1}, metadata={})
        pause_event = NodeRunPauseRequestedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
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

    def test_get_workflow_execution_raises_when_uninitialized(self):
        layer, _, _, _ = _make_layer()

        with pytest.raises(ValueError, match="workflow execution not initialized"):
            layer._get_workflow_execution()

    def test_next_node_sequence_increments(self):
        layer, _, _, _ = _make_layer()
        assert layer._next_node_sequence() == 1
        assert layer._next_node_sequence() == 2

    def test_on_graph_end_is_noop(self):
        layer, _, _, _ = _make_layer()

        assert layer.on_graph_end(error=None) is None

    def test_on_event_dispatches_to_all_known_handlers(self):
        layer, _, _, _ = _make_layer()
        called: list[str] = []

        def _record(name: str):
            def _handler(*_args, **_kwargs):
                called.append(name)

            return _handler

        layer._handle_graph_run_started = _record("started")
        layer._handle_graph_run_succeeded = _record("succeeded")
        layer._handle_graph_run_partial_succeeded = _record("partial")
        layer._handle_graph_run_failed = _record("failed")
        layer._handle_graph_run_aborted = _record("aborted")
        layer._handle_graph_run_paused = _record("paused")
        layer._handle_node_started = _record("node_started")
        layer._handle_node_retry = _record("node_retry")
        layer._handle_node_succeeded = _record("node_succeeded")
        layer._handle_node_failed = _record("node_failed")
        layer._handle_node_exception = _record("node_exception")
        layer._handle_node_pause_requested = _record("node_paused")

        node_result = NodeRunResult()
        now = _naive_utc_now()
        events = [
            GraphRunStartedEvent(),
            GraphRunSucceededEvent(outputs={"ok": True}),
            GraphRunPartialSucceededEvent(outputs={"ok": True}, exceptions_count=1),
            GraphRunFailedEvent(error="boom", exceptions_count=1),
            GraphRunAbortedEvent(reason="stop", outputs={"x": 1}),
            GraphRunPausedEvent(outputs={"pause": True}),
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                node_title="Start",
                start_at=now,
            ),
            NodeRunRetryEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                node_title="Start",
                start_at=now,
                error="retry",
                retry_index=1,
            ),
            NodeRunSucceededEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                start_at=now,
                node_run_result=node_result,
            ),
            NodeRunFailedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                start_at=now,
                error="failed",
                node_run_result=node_result,
            ),
            NodeRunExceptionEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                start_at=now,
                error="error",
                node_run_result=node_result,
            ),
            NodeRunPauseRequestedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                reason=SchedulingPause(message="pause"),
                node_run_result=node_result,
            ),
        ]
        expected_order = [
            "started",
            "succeeded",
            "partial",
            "failed",
            "aborted",
            "paused",
            "node_started",
            "node_retry",
            "node_succeeded",
            "node_failed",
            "node_exception",
            "node_paused",
        ]

        for event in events:
            layer.on_event(event)

        assert called == expected_order

    def test_on_event_dispatches_retry_before_started_for_retry_event(self):
        layer, _, _, _ = _make_layer()
        called: list[str] = []

        def _record(name: str):
            def _handler(*_args, **_kwargs):
                called.append(name)

            return _handler

        layer._handle_node_started = _record("node_started")
        layer._handle_node_retry = _record("node_retry")

        layer.on_event(
            NodeRunRetryEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.START,
                node_title="Start",
                start_at=_naive_utc_now(),
                error="retry",
                retry_index=1,
            )
        )

        assert called == ["node_retry"]

    def test_enqueue_trace_task_skips_when_disabled(self):
        trace_tasks: list[object] = []
        layer, exec_repo, _, _ = _make_layer()
        layer._handle_graph_run_started()
        layer._handle_graph_run_succeeded(GraphRunSucceededEvent(outputs={"ok": True}))
        assert exec_repo.saved
        assert not trace_tasks
