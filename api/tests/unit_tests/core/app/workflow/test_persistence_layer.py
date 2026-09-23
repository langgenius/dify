from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.workflow.layers.persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.ops.ops_trace_manager import TraceTask, TraceTaskName
from core.workflow.system_variables import SystemVariableKey, build_system_variables
from graphon.engine_events import (
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities import WorkflowNodeExecution, WorkflowStartReason
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool


class _RepoRecorder:
    def __init__(self) -> None:
        self.saved: list[object] = []
        self.synchronously_saved: list[object] = []
        self.saved_exec_data: list[object] = []

    def save(self, entity):
        self.saved.append(entity)

    def save_synchronously(self, entity):
        self.synchronously_saved.append(entity)

    def save_execution_data(self, entity):
        self.saved_exec_data.append(entity)


def _naive_utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _make_layer(
    system_variables: list | None = None,
    *,
    extras: dict | None = None,
    graph_data: dict | None = None,
    trace_manager: object | None = None,
    workflow_execution_repo=None,
    workflow_node_execution_repo=None,
    node_run_indices=None,
):
    system_variables = system_variables or build_system_variables(
        workflow_execution_id="run-id",
        conversation_id="conv-id",
    )
    runtime_state = RuntimeState(
        workflow_id="test-workflow",
        variable_pool=VariablePool.from_bootstrap(system_variables=system_variables),
        start_at=0.0,
    )
    read_only_state = ReadOnlyRuntimeStateWrapper(runtime_state)

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
        graph_data=graph_data if graph_data is not None else {"nodes": [], "edges": []},
    )

    workflow_execution_repo = workflow_execution_repo if workflow_execution_repo is not None else _RepoRecorder()
    workflow_node_execution_repo = (
        workflow_node_execution_repo if workflow_node_execution_repo is not None else _RepoRecorder()
    )

    layer = WorkflowPersistenceLayer(
        application_generate_entity=application_generate_entity,
        workflow_info=workflow_info,
        workflow_execution_repository=workflow_execution_repo,
        workflow_node_execution_repository=workflow_node_execution_repo,
        trace_manager=trace_manager,
    )
    layer.initialize(read_only_state, command_channel=None)
    layer.set_node_run_indices(node_run_indices or {})

    return layer, workflow_execution_repo, workflow_node_execution_repo, runtime_state


class TestWorkflowPersistenceLayer:
    def test_get_execution_id_requires_system_variable(self):
        layer, _, _, _ = _make_layer(build_system_variables())

        with pytest.raises(ValueError, match="workflow_execution_id must be provided"):
            layer._get_execution_id()

    def test_prepare_workflow_inputs_excludes_conversation_id(self, monkeypatch: pytest.MonkeyPatch):
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

    def test_resumption_restores_container_execution_before_terminal_event(self):
        layer, _, node_repo, _ = _make_layer()
        started_at = _naive_utc_now()
        execution = WorkflowNodeExecution(
            id="loop-exec",
            workflow_id="workflow-id",
            workflow_execution_id="run-id",
            index=4,
            node_id="loop",
            node_type=BuiltinNodeTypes.LOOP,
            title="Loop",
            status=WorkflowNodeExecutionStatus.RUNNING,
            created_at=started_at,
        )
        layer.set_node_execution_history([execution])

        layer.on_event(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
        layer.on_event(
            NodeRunSucceededEvent(
                id=execution.id,
                node_id=execution.node_id,
                node_type=execution.node_type,
                start_at=started_at,
                finished_at=started_at + timedelta(seconds=2),
                node_run_result=NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED),
            )
        )

        assert execution.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert execution.elapsed_time == 2.0
        assert execution.index == 4

    def test_handle_graph_run_succeeded_updates_execution(self):
        layer, exec_repo, _, runtime_state = _make_layer()
        layer.on_event(GraphRunStartedEvent())
        usage = LLMUsage.empty_usage()
        usage.total_tokens = 3
        runtime_state.add_llm_usage(usage)
        for _ in range(2):
            runtime_state.increment_node_run_steps()
        runtime_state.set_output("out", "v")

        layer.on_event(GraphRunSucceededEvent(outputs={"ok": True}))

        saved = exec_repo.saved[-1]
        assert saved.status == WorkflowExecutionStatus.SUCCEEDED
        assert saved.total_tokens == 3
        assert saved.total_steps == 2

    def test_handle_graph_run_partial_succeeded_updates_execution(self):
        layer, exec_repo, _, runtime_state = _make_layer()
        layer.on_event(GraphRunStartedEvent())
        usage = LLMUsage.empty_usage()
        usage.total_tokens = 5
        runtime_state.add_llm_usage(usage)
        for _ in range(4):
            runtime_state.increment_node_run_steps()
        runtime_state._graph_execution = SimpleNamespace(exceptions_count=2)

        layer.on_event(GraphRunPartialSucceededEvent(outputs={"ok": True}, exceptions_count=2))

        saved = exec_repo.saved[-1]
        assert saved.status == WorkflowExecutionStatus.PARTIAL_SUCCEEDED
        assert saved.exceptions_count == 2
        assert saved.total_tokens == 5

    def test_handle_graph_run_failed_marks_nodes_and_enqueues_trace(self):
        trace_tasks: list[object] = []
        trace_manager = SimpleNamespace(user_id="user", add_trace_task=lambda task: trace_tasks.append(task))
        layer, exec_repo, node_repo, _ = _make_layer(extras={"external_trace_id": "trace"}, trace_manager=trace_manager)
        layer.on_event(GraphRunStartedEvent())

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

        layer.on_event(GraphRunFailedEvent(error="boom", exceptions_count=1))

        assert node_repo.saved
        assert exec_repo.saved[-1].status == WorkflowExecutionStatus.FAILED
        assert trace_tasks

    def test_handle_graph_run_succeeded_enqueues_parent_trace_context(self, monkeypatch: pytest.MonkeyPatch):
        trace_tasks: list[TraceTask] = []
        trace_manager = SimpleNamespace(user_id="user", add_trace_task=lambda task: trace_tasks.append(task))
        layer, _, _, _ = _make_layer(
            extras={
                "external_trace_id": "trace",
                "trace_session_id": "session-1",
                "parent_trace_context": {
                    "parent_workflow_run_id": "outer-workflow-run-1",
                    "parent_node_execution_id": "outer-node-execution-1",
                },
            },
            trace_manager=trace_manager,
        )
        layer.on_event(GraphRunStartedEvent())

        captured: dict[str, object] = {}

        def fake_workflow_trace(
            self: TraceTask,
            *,
            workflow_run_id: str | None,
            conversation_id: str | None,
            user_id: str | None,
            total_tokens_override: int | None = None,
        ):
            captured["trace_type"] = self.trace_type
            captured["external_trace_id"] = self.kwargs.get("external_trace_id")
            captured["trace_session_id"] = self.kwargs.get("trace_session_id")
            captured["parent_trace_context"] = self.kwargs.get("parent_trace_context")
            captured["workflow_run_id"] = workflow_run_id
            return {"ok": True}

        monkeypatch.setattr(TraceTask, "workflow_trace", fake_workflow_trace)

        layer.on_event(GraphRunSucceededEvent(outputs={"ok": True}))

        assert trace_tasks
        trace_task = trace_tasks[0]
        assert trace_task.trace_type == TraceTaskName.WORKFLOW_TRACE
        assert trace_task.kwargs["external_trace_id"] == "trace"
        assert trace_task.kwargs["trace_session_id"] == "session-1"
        assert trace_task.kwargs["parent_trace_context"] == {
            "parent_workflow_run_id": "outer-workflow-run-1",
            "parent_node_execution_id": "outer-node-execution-1",
        }

        trace_task.execute()

        assert captured["trace_type"] == TraceTaskName.WORKFLOW_TRACE
        assert captured["external_trace_id"] == "trace"
        assert captured["trace_session_id"] == "session-1"
        assert captured["parent_trace_context"] == {
            "parent_workflow_run_id": "outer-workflow-run-1",
            "parent_node_execution_id": "outer-node-execution-1",
        }

    def test_handle_graph_run_aborted_sets_status(self):
        layer, exec_repo, _, _ = _make_layer()
        layer.on_event(GraphRunStartedEvent())

        layer.on_event(GraphRunAbortedEvent(reason=None, outputs={}))

        saved = exec_repo.saved[-1]
        assert saved.status == WorkflowExecutionStatus.STOPPED
        assert saved.error_message

    def test_handle_node_started_and_retry(self):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())

        start_event = NodeRunStartedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            node_title="Start",
            start_at=_naive_utc_now(),
            predecessor_node_id="prev",
        )
        layer.on_event(start_event)

        assert node_repo.saved
        assert "exec" in layer._node_execution_cache
        assert node_repo.saved[-1].created_at == start_event.start_at

        retry_event = NodeRunRetryEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.START,
            node_title="Start",
            start_at=_naive_utc_now(),
            error="retry",
            retry_index=1,
        )
        layer.on_event(retry_event)
        assert node_repo.saved_exec_data

    def test_agent_v2_caller_row_is_saved_synchronously_before_node_run(self):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"agent-exec": 1})
        layer.on_event(GraphRunStartedEvent())

        layer.on_event(
            NodeRunStartedEvent(
                id="agent-exec",
                node_id="agent-node",
                node_type=BuiltinNodeTypes.AGENT,
                node_version="2",
                node_title="Agent",
                start_at=_naive_utc_now(),
            )
        )

        assert [execution.id for execution in node_repo.synchronously_saved] == ["agent-exec"]
        assert node_repo.saved == []

    def test_retry_history_is_preserved_after_node_succeeds(self):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        started_at = _naive_utc_now()
        layer.on_event(
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.HTTP_REQUEST,
                node_title="HTTP",
                start_at=started_at,
            )
        )

        for retry_index in (1, 2):
            layer.on_event(
                NodeRunRetryEvent(
                    id="exec",
                    node_id="node",
                    node_type=BuiltinNodeTypes.HTTP_REQUEST,
                    node_title="HTTP",
                    start_at=started_at,
                    error=f"attempt {retry_index} failed",
                    retry_index=retry_index,
                    node_run_result=NodeRunResult(
                        inputs={"attempt": retry_index},
                        process_data={"request": f"attempt-{retry_index}"},
                        outputs={"status_code": 500, "body": f"failure-{retry_index}"},
                        metadata={WorkflowNodeExecutionMetadataKey.ITERATION_ID: "iteration-1"},
                    ),
                )
            )

        layer.on_event(
            NodeRunSucceededEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.HTTP_REQUEST,
                start_at=started_at,
                node_run_result=NodeRunResult(
                    inputs={"attempt": 3},
                    process_data={"request": "successful-attempt"},
                    outputs={"status_code": 200, "body": "ok"},
                    metadata={},
                ),
            )
        )

        saved_execution = node_repo.saved_exec_data[-1]
        assert saved_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert saved_execution.process_data["request"] == "successful-attempt"
        retry_history = saved_execution.process_data["__dify_retry_history"]
        assert [attempt["retry_index"] for attempt in retry_history] == [1, 2]
        assert retry_history[0]["inputs"] == {"attempt": 1}
        assert retry_history[0]["process_data"] == {"request": "attempt-1"}
        assert retry_history[0]["outputs"] == {"status_code": 500, "body": "failure-1"}
        assert retry_history[0]["error"] == "attempt 1 failed"
        assert retry_history[0]["execution_metadata"] == {"iteration_id": "iteration-1"}

    @pytest.mark.parametrize(
        ("event_type", "expected_status"),
        [
            (NodeRunFailedEvent, WorkflowNodeExecutionStatus.FAILED),
            (NodeRunExceptionEvent, WorkflowNodeExecutionStatus.EXCEPTION),
        ],
    )
    def test_retry_history_is_preserved_after_terminal_error(self, event_type, expected_status):
        layer, _, node_repo, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        started_at = _naive_utc_now()
        layer.on_event(
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="LLM",
                start_at=started_at,
            )
        )
        layer.on_event(
            NodeRunRetryEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.LLM,
                node_title="LLM",
                start_at=started_at,
                error="retry failed",
                retry_index=1,
                node_run_result=NodeRunResult(outputs={"attempt": 1}),
            )
        )

        terminal_event = event_type(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            start_at=started_at,
            error="terminal failure",
            node_run_result=NodeRunResult(process_data={"terminal": True}),
        )
        layer.on_event(terminal_event)

        saved_execution = node_repo.saved_exec_data[-1]
        assert saved_execution.status == expected_status
        assert saved_execution.process_data["terminal"] is True
        assert saved_execution.process_data["__dify_retry_history"][0]["retry_index"] == 1

    def test_handle_node_pause_requested_skips_outputs(self):
        layer, _, _, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        start_event = NodeRunStartedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            node_title="LLM",
            start_at=_naive_utc_now(),
        )
        layer.on_event(start_event)

        domain_execution = layer._node_execution_cache["exec"]
        domain_execution.inputs = {"old": True}

        result = NodeRunResult(
            inputs={"new": True},
            outputs={"out": 1},
            process_data={
                "p": 1,
                "workflow_agent_binding_id": "workflow-binding-1",
            },
            metadata={},
        )
        pause_event = NodeRunPauseRequestedEvent(
            id="exec",
            node_id="node",
            node_type=BuiltinNodeTypes.LLM,
            reason=SchedulingPause(message="pause"),
            node_run_result=result,
        )
        layer.on_event(pause_event)

        assert domain_execution.status == WorkflowNodeExecutionStatus.PAUSED
        assert domain_execution.inputs == {"old": True}
        assert domain_execution.process_data == {
            "workflow_agent_binding_id": "workflow-binding-1",
        }

    def test_handle_node_retry_preserves_workflow_agent_binding_identity(self):
        layer, _, _, _ = _make_layer(node_run_indices={"exec": 1})
        layer.on_event(GraphRunStartedEvent())
        started_at = _naive_utc_now()
        layer.on_event(
            NodeRunStartedEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.AGENT,
                node_title="Agent",
                start_at=started_at,
            )
        )

        layer.on_event(
            NodeRunRetryEvent(
                id="exec",
                node_id="node",
                node_type=BuiltinNodeTypes.AGENT,
                node_title="Agent",
                start_at=started_at,
                error="retry",
                retry_index=1,
                node_run_result=NodeRunResult(
                    process_data={
                        "workflow_agent_binding_id": "workflow-binding-1",
                    },
                ),
            )
        )

        assert layer._node_execution_cache["exec"].process_data["workflow_agent_binding_id"] == "workflow-binding-1"

    def test_get_node_execution_raises_for_missing(self):
        layer, _, _, _ = _make_layer()
        with pytest.raises(ValueError, match="Node execution not found"):
            layer._get_node_execution("missing")

    def test_get_workflow_execution_raises_when_uninitialized(self):
        layer, _, _, _ = _make_layer()

        with pytest.raises(ValueError, match="workflow execution not initialized"):
            layer._get_workflow_execution()
