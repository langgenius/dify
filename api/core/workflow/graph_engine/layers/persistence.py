"""Workflow persistence layer for GraphEngine.

This layer mirrors the former ``WorkflowCycleManager`` responsibilities by
listening to ``GraphEngineEvent`` instances directly and persisting workflow
and node execution state via the injected repositories.

The design keeps domain persistence concerns inside the engine thread, while
allowing presentation layers to remain read-only observers of repository
state.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Union

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities import WorkflowExecution, WorkflowNodeExecution
from core.workflow.enums import (
    SystemVariableKey,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events import (
    GraphEngineEvent,
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
from core.workflow.node_events import NodeRunResult
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.workflow_entry import WorkflowEntry
from libs.datetime_utils import naive_utc_now


@dataclass(slots=True)
class PersistenceWorkflowInfo:
    """Static workflow metadata required for persistence."""

    workflow_id: str
    workflow_type: WorkflowType
    version: str
    graph_data: Mapping[str, Any]


@dataclass(slots=True)
class _NodeRuntimeSnapshot:
    """Lightweight cache to keep node metadata across event phases."""

    node_id: str
    title: str
    predecessor_node_id: str | None
    iteration_id: str | None
    loop_id: str | None
    created_at: datetime


class WorkflowPersistenceLayer(GraphEngineLayer):
    """GraphEngine layer that persists workflow and node execution state."""

    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
        workflow_info: PersistenceWorkflowInfo,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
        trace_manager: TraceQueueManager | None = None,
    ) -> None:
        super().__init__()
        self._application_generate_entity = application_generate_entity
        self._workflow_info = workflow_info
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository
        self._trace_manager = trace_manager

        self._workflow_execution: WorkflowExecution | None = None
        self._node_execution_cache: dict[str, WorkflowNodeExecution] = {}
        self._node_snapshots: dict[str, _NodeRuntimeSnapshot] = {}
        self._node_sequence: int = 0

    # ------------------------------------------------------------------
    # GraphEngineLayer lifecycle
    # ------------------------------------------------------------------
    def on_graph_start(self) -> None:
        self._workflow_execution = None
        self._node_execution_cache.clear()
        self._node_snapshots.clear()
        self._node_sequence = 0

    def on_event(self, event: GraphEngineEvent) -> None:
        if isinstance(event, GraphRunStartedEvent):
            self._handle_graph_run_started()
            return

        if isinstance(event, GraphRunSucceededEvent):
            self._handle_graph_run_succeeded(event)
            return

        if isinstance(event, GraphRunPartialSucceededEvent):
            self._handle_graph_run_partial_succeeded(event)
            return

        if isinstance(event, GraphRunFailedEvent):
            self._handle_graph_run_failed(event)
            return

        if isinstance(event, GraphRunAbortedEvent):
            self._handle_graph_run_aborted(event)
            return

        if isinstance(event, GraphRunPausedEvent):
            self._handle_graph_run_paused(event)
            return

        if isinstance(event, NodeRunStartedEvent):
            self._handle_node_started(event)
            return

        if isinstance(event, NodeRunRetryEvent):
            self._handle_node_retry(event)
            return

        if isinstance(event, NodeRunSucceededEvent):
            self._handle_node_succeeded(event)
            return

        if isinstance(event, NodeRunFailedEvent):
            self._handle_node_failed(event)
            return

        if isinstance(event, NodeRunExceptionEvent):
            self._handle_node_exception(event)
            return

        if isinstance(event, NodeRunPauseRequestedEvent):
            self._handle_node_pause_requested(event)

    def on_graph_end(self, error: Exception | None) -> None:
        return

    # ------------------------------------------------------------------
    # Graph-level handlers
    # ------------------------------------------------------------------
    def _handle_graph_run_started(self) -> None:
        execution_id = self._get_execution_id()
        workflow_execution = WorkflowExecution.new(
            id_=execution_id,
            workflow_id=self._workflow_info.workflow_id,
            workflow_type=self._workflow_info.workflow_type,
            workflow_version=self._workflow_info.version,
            graph=self._workflow_info.graph_data,
            inputs=self._prepare_workflow_inputs(),
            started_at=naive_utc_now(),
        )

        self._workflow_execution_repository.save(workflow_execution)
        self._workflow_execution = workflow_execution

    def _handle_graph_run_succeeded(self, event: GraphRunSucceededEvent) -> None:
        execution = self._get_workflow_execution()
        execution.outputs = event.outputs
        execution.status = WorkflowExecutionStatus.SUCCEEDED
        self._populate_completion_statistics(execution)

        self._workflow_execution_repository.save(execution)
        self._enqueue_trace_task(execution)

    def _handle_graph_run_partial_succeeded(self, event: GraphRunPartialSucceededEvent) -> None:
        execution = self._get_workflow_execution()
        execution.outputs = event.outputs
        execution.status = WorkflowExecutionStatus.PARTIAL_SUCCEEDED
        execution.exceptions_count = event.exceptions_count
        self._populate_completion_statistics(execution)

        self._workflow_execution_repository.save(execution)
        self._enqueue_trace_task(execution)

    def _handle_graph_run_failed(self, event: GraphRunFailedEvent) -> None:
        execution = self._get_workflow_execution()
        execution.status = WorkflowExecutionStatus.FAILED
        execution.error_message = event.error
        execution.exceptions_count = event.exceptions_count
        self._populate_completion_statistics(execution)

        self._fail_running_node_executions(error_message=event.error)
        self._workflow_execution_repository.save(execution)
        self._enqueue_trace_task(execution)

    def _handle_graph_run_aborted(self, event: GraphRunAbortedEvent) -> None:
        execution = self._get_workflow_execution()
        execution.status = WorkflowExecutionStatus.STOPPED
        execution.error_message = event.reason or "Workflow execution aborted"
        self._populate_completion_statistics(execution)

        self._fail_running_node_executions(error_message=execution.error_message or "")
        self._workflow_execution_repository.save(execution)
        self._enqueue_trace_task(execution)

    def _handle_graph_run_paused(self, event: GraphRunPausedEvent) -> None:
        execution = self._get_workflow_execution()
        execution.status = WorkflowExecutionStatus.PAUSED
        execution.outputs = event.outputs
        self._populate_completion_statistics(execution, update_finished=False)

        self._workflow_execution_repository.save(execution)

    # ------------------------------------------------------------------
    # Node-level handlers
    # ------------------------------------------------------------------
    def _handle_node_started(self, event: NodeRunStartedEvent) -> None:
        execution = self._get_workflow_execution()

        metadata = {
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: event.in_iteration_id,
            WorkflowNodeExecutionMetadataKey.LOOP_ID: event.in_loop_id,
        }

        domain_execution = WorkflowNodeExecution(
            id=event.id,
            node_execution_id=event.id,
            workflow_id=execution.workflow_id,
            workflow_execution_id=execution.id_,
            predecessor_node_id=event.predecessor_node_id,
            index=self._next_node_sequence(),
            node_id=event.node_id,
            node_type=event.node_type,
            title=event.node_title,
            status=WorkflowNodeExecutionStatus.RUNNING,
            metadata=metadata,
            created_at=event.start_at,
        )

        self._node_execution_cache[event.id] = domain_execution
        self._workflow_node_execution_repository.save(domain_execution)

        snapshot = _NodeRuntimeSnapshot(
            node_id=event.node_id,
            title=event.node_title,
            predecessor_node_id=event.predecessor_node_id,
            iteration_id=event.in_iteration_id,
            loop_id=event.in_loop_id,
            created_at=event.start_at,
        )
        self._node_snapshots[event.id] = snapshot

    def _handle_node_retry(self, event: NodeRunRetryEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        domain_execution.status = WorkflowNodeExecutionStatus.RETRY
        domain_execution.error = event.error
        self._workflow_node_execution_repository.save(domain_execution)
        self._workflow_node_execution_repository.save_execution_data(domain_execution)

    def _handle_node_succeeded(self, event: NodeRunSucceededEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        self._update_node_execution(domain_execution, event.node_run_result, WorkflowNodeExecutionStatus.SUCCEEDED)

    def _handle_node_failed(self, event: NodeRunFailedEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        self._update_node_execution(
            domain_execution,
            event.node_run_result,
            WorkflowNodeExecutionStatus.FAILED,
            error=event.error,
        )

    def _handle_node_exception(self, event: NodeRunExceptionEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        self._update_node_execution(
            domain_execution,
            event.node_run_result,
            WorkflowNodeExecutionStatus.EXCEPTION,
            error=event.error,
        )

    def _handle_node_pause_requested(self, event: NodeRunPauseRequestedEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        self._update_node_execution(
            domain_execution,
            event.node_run_result,
            WorkflowNodeExecutionStatus.PAUSED,
            error="",
            update_outputs=False,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _get_execution_id(self) -> str:
        workflow_execution_id = self._system_variables().get(SystemVariableKey.WORKFLOW_EXECUTION_ID)
        if not workflow_execution_id:
            raise ValueError("workflow_execution_id must be provided in system variables for pause/resume flows")
        return str(workflow_execution_id)

    def _prepare_workflow_inputs(self) -> Mapping[str, Any]:
        inputs = {**self._application_generate_entity.inputs}
        for field_name, value in self._system_variables().items():
            if field_name == SystemVariableKey.CONVERSATION_ID.value:
                # Conversation IDs are tied to the current session; omit them so persisted
                # workflow inputs stay reusable without binding future runs to this conversation.
                continue
            inputs[f"sys.{field_name}"] = value
        handled = WorkflowEntry.handle_special_values(inputs)
        return handled or {}

    def _get_workflow_execution(self) -> WorkflowExecution:
        if self._workflow_execution is None:
            raise ValueError("workflow execution not initialized")
        return self._workflow_execution

    def _get_node_execution(self, node_execution_id: str) -> WorkflowNodeExecution:
        if node_execution_id not in self._node_execution_cache:
            raise ValueError(f"Node execution not found for id={node_execution_id}")
        return self._node_execution_cache[node_execution_id]

    def _next_node_sequence(self) -> int:
        self._node_sequence += 1
        return self._node_sequence

    def _populate_completion_statistics(self, execution: WorkflowExecution, *, update_finished: bool = True) -> None:
        if update_finished:
            execution.finished_at = naive_utc_now()
        runtime_state = self.graph_runtime_state
        if runtime_state is None:
            return
        execution.total_tokens = runtime_state.total_tokens
        execution.total_steps = runtime_state.node_run_steps
        execution.outputs = execution.outputs or runtime_state.outputs
        execution.exceptions_count = runtime_state.exceptions_count

    def _update_node_execution(
        self,
        domain_execution: WorkflowNodeExecution,
        node_result: NodeRunResult,
        status: WorkflowNodeExecutionStatus,
        *,
        error: str | None = None,
        update_outputs: bool = True,
    ) -> None:
        finished_at = naive_utc_now()
        snapshot = self._node_snapshots.get(domain_execution.id)
        start_at = snapshot.created_at if snapshot else domain_execution.created_at
        domain_execution.status = status
        domain_execution.finished_at = finished_at
        domain_execution.elapsed_time = max((finished_at - start_at).total_seconds(), 0.0)

        if error:
            domain_execution.error = error

        if update_outputs:
            domain_execution.update_from_mapping(
                inputs=node_result.inputs,
                process_data=node_result.process_data,
                outputs=node_result.outputs,
                metadata=node_result.metadata,
            )

        self._workflow_node_execution_repository.save(domain_execution)
        self._workflow_node_execution_repository.save_execution_data(domain_execution)

    def _fail_running_node_executions(self, *, error_message: str) -> None:
        now = naive_utc_now()
        for execution in self._node_execution_cache.values():
            if execution.status == WorkflowNodeExecutionStatus.RUNNING:
                execution.status = WorkflowNodeExecutionStatus.FAILED
                execution.error = error_message
                execution.finished_at = now
                execution.elapsed_time = max((now - execution.created_at).total_seconds(), 0.0)
                self._workflow_node_execution_repository.save(execution)

    def _enqueue_trace_task(self, execution: WorkflowExecution) -> None:
        if not self._trace_manager:
            return

        conversation_id = self._system_variables().get(SystemVariableKey.CONVERSATION_ID.value)
        external_trace_id = None
        if isinstance(self._application_generate_entity, (WorkflowAppGenerateEntity, AdvancedChatAppGenerateEntity)):
            external_trace_id = self._application_generate_entity.extras.get("external_trace_id")

        trace_task = TraceTask(
            TraceTaskName.WORKFLOW_TRACE,
            workflow_execution=execution,
            conversation_id=conversation_id,
            user_id=self._trace_manager.user_id,
            external_trace_id=external_trace_id,
        )
        self._trace_manager.add_trace_task(trace_task)

    def _system_variables(self) -> Mapping[str, Any]:
        runtime_state = self.graph_runtime_state
        if runtime_state is None:
            return {}
        return runtime_state.variable_pool.get_by_prefix(SYSTEM_VARIABLE_NODE_ID)
