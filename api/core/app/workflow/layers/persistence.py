"""Workflow persistence layer for Engine.

This layer mirrors the former ``WorkflowCycleManager`` responsibilities by
listening to ``EngineEvent`` instances directly and persisting workflow
and node execution state via the injected repositories.

The design keeps domain persistence concerns inside the engine thread, while
allowing presentation layers to remain read-only observers of repository
state.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Union, override

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY, WorkflowNodeRetryAttempt
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.workflow.node_execution_process_data import WORKFLOW_TOOL_ROOT_APP_ID_KEY, keep_agent_and_tool_ids
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import SYSTEM_VARIABLE_NODE_ID
from core.workflow.workflow_run_outputs import project_node_outputs_for_workflow_run
from graphon.engine.layer import Layer
from graphon.engine_events import (
    EngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunPauseRequestedEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunSucceededEvent,
)
from graphon.entities import WorkflowExecution, WorkflowNodeExecution, WorkflowStartReason
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from services.workflow.inspector_events import (
    publish_node_changed as _inspector_publish_node_changed,
)
from services.workflow.inspector_events import (
    publish_workflow_completed as _inspector_publish_workflow_completed,
)


@dataclass(slots=True)
class PersistenceWorkflowInfo:
    """Static workflow metadata required for persistence."""

    workflow_id: str
    workflow_type: WorkflowType
    version: str
    graph_data: Mapping[str, Any]


class WorkflowPersistenceLayer(Layer):
    """Engine layer that persists workflow and node execution state."""

    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
        workflow_info: PersistenceWorkflowInfo,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ) -> None:
        super().__init__()
        self._application_generate_entity = application_generate_entity
        self._workflow_info = workflow_info
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository

        self._workflow_execution: WorkflowExecution | None = None
        self._node_execution_cache: dict[str, WorkflowNodeExecution] = {}
        self._node_sequence: int = 0
        self._is_resuming = False
        self._workflow_tool_layers: dict[tuple[str, str], WorkflowPersistenceLayer] = {}

    def create_workflow_tool_event_listener(self, source: WorkflowToolSource) -> Callable[[NodeEvent], None]:
        """Persist hidden tool nodes under their source app, without creating another run."""
        key = (source.app_id, source.workflow_id)
        tool_layer = self._workflow_tool_layers.get(key)
        if tool_layer is None:
            tool_layer = WorkflowPersistenceLayer(
                application_generate_entity=self._application_generate_entity,
                workflow_info=PersistenceWorkflowInfo(
                    workflow_id=source.workflow_id,
                    workflow_type=WorkflowType.WORKFLOW,
                    version="",
                    graph_data=source.graph_config,
                ),
                workflow_execution_repository=self._workflow_execution_repository,
                workflow_node_execution_repository=self._workflow_node_execution_repository.for_workflow_tool(
                    source.app_id
                ),
            )
            self._workflow_tool_layers[key] = tool_layer

        def on_node_event(event: NodeEvent) -> None:
            self._prepare_workflow_tool_layer(tool_layer)
            # Lifecycle ownership must survive independently of the configured run-log store.
            event.node_run_result.process_data = {
                **event.node_run_result.process_data,
                WORKFLOW_TOOL_ROOT_APP_ID_KEY: self._application_generate_entity.app_config.app_id,
            }
            tool_layer.on_event(event)

        return on_node_event

    def _prepare_workflow_tool_layer(self, tool_layer: "WorkflowPersistenceLayer") -> None:
        execution = self._get_workflow_execution()
        if tool_layer._workflow_execution is execution:
            return
        tool_layer._workflow_execution = execution
        if self._is_resuming:
            node_executions = tool_layer._workflow_node_execution_repository.get_by_workflow_execution(execution.id_)
            tool_layer._node_execution_cache = {
                node.id: node for node in node_executions if node.workflow_id == tool_layer._workflow_info.workflow_id
            }
            tool_layer._node_sequence = max(
                (node.index for node in tool_layer._node_execution_cache.values()), default=0
            )

    # ------------------------------------------------------------------
    # Layer lifecycle
    # ------------------------------------------------------------------
    @override
    def on_graph_start(self) -> None:
        self._workflow_execution = None
        self._node_execution_cache.clear()
        self._node_sequence = 0
        self._is_resuming = False
        for tool_layer in self._workflow_tool_layers.values():
            tool_layer.on_graph_start()

    @override
    def on_event(self, event: EngineEvent) -> None:
        match event:
            case GraphRunStartedEvent():
                self._handle_graph_run_started(event)
            case GraphRunSucceededEvent():
                self._handle_graph_run_succeeded(event)
            case GraphRunPartialSucceededEvent():
                self._handle_graph_run_partial_succeeded(event)
            case GraphRunFailedEvent():
                self._handle_graph_run_failed(event)
            case GraphRunAbortedEvent():
                self._handle_graph_run_aborted(event)
            case GraphRunPausedEvent():
                self._handle_graph_run_paused(event)
            case NodeRunRetryEvent():
                self._handle_node_retry(event)
            case NodeRunStartedEvent():
                self._handle_node_started(event)
            case NodeRunSucceededEvent():
                self._handle_node_succeeded(event)
            case NodeRunFailedEvent():
                self._handle_node_failed(event)
            case NodeRunExceptionEvent():
                self._handle_node_exception(event)
            case NodeRunPauseRequestedEvent():
                self._handle_node_pause_requested(event)

    # ------------------------------------------------------------------
    # Graph-level handlers
    # ------------------------------------------------------------------
    def _handle_graph_run_started(self, event: GraphRunStartedEvent | None = None) -> None:
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
        self._is_resuming = event is not None and event.reason == WorkflowStartReason.RESUMPTION
        if self._is_resuming:
            node_executions = self._workflow_node_execution_repository.get_by_workflow_execution(execution_id)
            self._node_execution_cache = {execution.id: execution for execution in node_executions}
            self._node_sequence = max((execution.index for execution in node_executions), default=0)

    def _handle_graph_run_succeeded(self, event: GraphRunSucceededEvent) -> None:
        execution = self._get_workflow_execution()
        execution.outputs = event.outputs
        execution.status = WorkflowExecutionStatus.SUCCEEDED
        self._finish_workflow_execution(execution)

    def _handle_graph_run_partial_succeeded(self, event: GraphRunPartialSucceededEvent) -> None:
        execution = self._get_workflow_execution()
        execution.outputs = event.outputs
        execution.status = WorkflowExecutionStatus.PARTIAL_SUCCEEDED
        execution.exceptions_count = event.exceptions_count
        self._finish_workflow_execution(execution)

    def _handle_graph_run_failed(self, event: GraphRunFailedEvent) -> None:
        execution = self._get_workflow_execution()
        execution.status = WorkflowExecutionStatus.FAILED
        execution.error_message = event.error
        execution.exceptions_count = event.exceptions_count
        self._finish_workflow_execution(execution)

    def _handle_graph_run_aborted(self, event: GraphRunAbortedEvent) -> None:
        execution = self._get_workflow_execution()
        execution.status = WorkflowExecutionStatus.STOPPED
        execution.error_message = event.reason or "Workflow execution aborted"
        self._finish_workflow_execution(execution)

    def _finish_workflow_execution(self, execution: WorkflowExecution) -> None:
        self._populate_completion_statistics(execution)
        if execution.status in (WorkflowExecutionStatus.FAILED, WorkflowExecutionStatus.STOPPED):
            self._fail_running_node_executions(error_message=execution.error_message or "")
        self._workflow_execution_repository.save(execution)
        _inspector_publish_workflow_completed(workflow_run_id=execution.id_, status=str(execution.status.value))

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
        iteration_id = event.node_run_result.metadata.get(WorkflowNodeExecutionMetadataKey.ITERATION_ID)
        loop_id = event.node_run_result.metadata.get(WorkflowNodeExecutionMetadataKey.LOOP_ID)

        metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = {
            **event.node_run_result.metadata,
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: iteration_id,
            WorkflowNodeExecutionMetadataKey.LOOP_ID: loop_id,
        }
        if event.node_type == BuiltinNodeTypes.TOOL and event.provider_type:
            metadata[WorkflowNodeExecutionMetadataKey.TOOL_INFO] = {
                "provider_type": event.provider_type,
                "provider_id": event.provider_id,
            }

        domain_execution = WorkflowNodeExecution(
            id=event.id,
            node_execution_id=event.id,
            workflow_id=self._workflow_info.workflow_id,
            workflow_execution_id=execution.id_,
            predecessor_node_id=event.predecessor_node_id,
            index=self._next_node_sequence(),
            node_id=event.node_id,
            node_type=event.node_type,
            title=event.node_title,
            status=WorkflowNodeExecutionStatus.RUNNING,
            process_data=event.node_run_result.process_data or None,
            metadata=metadata,
            created_at=event.start_at,
        )

        self._node_execution_cache[event.id] = domain_execution
        if event.node_type == BuiltinNodeTypes.AGENT and event.node_version == "2":
            self._workflow_node_execution_repository.save_synchronously(domain_execution)
        else:
            self._workflow_node_execution_repository.save(domain_execution)

        _inspector_publish_node_changed(workflow_run_id=execution.id_, node_id=event.node_id, status="running")

    def _handle_node_retry(self, event: NodeRunRetryEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        domain_execution.status = WorkflowNodeExecutionStatus.RETRY
        domain_execution.error = event.error
        self._append_retry_history(domain_execution, event)
        self._workflow_node_execution_repository.save(domain_execution)
        self._workflow_node_execution_repository.save_execution_data(domain_execution)
        _inspector_publish_node_changed(
            workflow_run_id=self._get_workflow_execution().id_,
            node_id=domain_execution.node_id,
            status="retry",
        )

    def _handle_node_succeeded(self, event: NodeRunSucceededEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        self._update_node_execution(
            domain_execution,
            event.node_run_result,
            WorkflowNodeExecutionStatus.SUCCEEDED,
            finished_at=event.finished_at,
        )
        _inspector_publish_node_changed(
            workflow_run_id=self._get_workflow_execution().id_,
            node_id=domain_execution.node_id,
            status="succeeded",
        )

    def _handle_node_failed(self, event: NodeRunFailedEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        self._update_node_execution(
            domain_execution,
            event.node_run_result,
            WorkflowNodeExecutionStatus.FAILED,
            error=event.error,
            finished_at=event.finished_at,
        )
        _inspector_publish_node_changed(
            workflow_run_id=self._get_workflow_execution().id_,
            node_id=domain_execution.node_id,
            status="failed",
        )

    def _handle_node_exception(self, event: NodeRunExceptionEvent) -> None:
        domain_execution = self._get_node_execution(event.id)
        self._update_node_execution(
            domain_execution,
            event.node_run_result,
            WorkflowNodeExecutionStatus.EXCEPTION,
            error=event.error,
            finished_at=event.finished_at,
        )
        _inspector_publish_node_changed(
            workflow_run_id=self._get_workflow_execution().id_,
            node_id=domain_execution.node_id,
            status="exception",
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
        # Local import to avoid circular dependency during app bootstrapping.
        from core.workflow.workflow_entry import WorkflowEntry

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

    def _append_retry_history(self, execution: WorkflowNodeExecution, event: NodeRunRetryEvent) -> None:
        """Append a validated full attempt before repository truncation or offload."""
        finished_at = naive_utc_now()
        process_data = keep_agent_and_tool_ids(
            event.node_run_result.process_data,
            execution.process_data,
        )
        process_data = dict(process_data or {})
        raw_history = process_data.get(RETRY_HISTORY_PROCESS_DATA_KEY)
        history = list(raw_history) if isinstance(raw_history, list) else []
        projected_outputs = project_node_outputs_for_workflow_run(
            node_type=execution.node_type,
            inputs=event.node_run_result.inputs,
            outputs=event.node_run_result.outputs,
        )
        attempt = WorkflowNodeRetryAttempt(
            retry_index=event.retry_index,
            inputs=event.node_run_result.inputs,
            process_data=event.node_run_result.process_data,
            outputs=projected_outputs,
            error=event.node_run_result.error or event.error,
            elapsed_time=max((finished_at - event.start_at).total_seconds(), 0.0),
            execution_metadata={key.value: value for key, value in event.node_run_result.metadata.items()},
            created_at=int(event.start_at.timestamp()),
            finished_at=int(finished_at.timestamp()),
        )
        history.append(attempt.model_dump(mode="json"))
        process_data[RETRY_HISTORY_PROCESS_DATA_KEY] = history
        execution.process_data = process_data

    @staticmethod
    def _merge_retry_history(
        existing_process_data: Mapping[str, Any] | None,
        next_process_data: Mapping[str, Any] | None,
    ) -> Mapping[str, Any] | None:
        """Keep internal retry history while replacing node-specific Process Data."""
        merged_process_data = keep_agent_and_tool_ids(existing_process_data, next_process_data)
        raw_history = (existing_process_data or {}).get(RETRY_HISTORY_PROCESS_DATA_KEY)
        if not isinstance(raw_history, list) or not raw_history:
            return merged_process_data

        merged_process_data = dict(merged_process_data or {})
        merged_process_data[RETRY_HISTORY_PROCESS_DATA_KEY] = raw_history
        return merged_process_data

    def _populate_completion_statistics(self, execution: WorkflowExecution, *, update_finished: bool = True) -> None:
        if update_finished:
            execution.finished_at = naive_utc_now()
        runtime_state = self.runtime_state
        execution.total_tokens = runtime_state.total_tokens
        execution.total_steps = runtime_state.node_run_steps
        execution.outputs = execution.outputs or runtime_state.outputs
        execution.exceptions_count = max(execution.exceptions_count, runtime_state.exceptions_count)

    def _update_node_execution(
        self,
        domain_execution: WorkflowNodeExecution,
        node_result: NodeRunResult,
        status: WorkflowNodeExecutionStatus,
        *,
        error: str | None = None,
        update_outputs: bool = True,
        finished_at: datetime | None = None,
    ) -> None:
        actual_finished_at = finished_at or naive_utc_now()
        domain_execution.status = status
        domain_execution.finished_at = actual_finished_at
        domain_execution.elapsed_time = max((actual_finished_at - domain_execution.created_at).total_seconds(), 0.0)

        if error:
            domain_execution.error = error

        if update_outputs:
            projected_outputs = project_node_outputs_for_workflow_run(
                node_type=domain_execution.node_type,
                inputs=node_result.inputs,
                outputs=node_result.outputs,
            )
            process_data = self._merge_retry_history(domain_execution.process_data, node_result.process_data)
            domain_execution.update_from_mapping(
                inputs=node_result.inputs,
                process_data=process_data,
                outputs=projected_outputs,
                metadata={**(domain_execution.metadata or {}), **node_result.metadata},
            )
        else:
            domain_execution.process_data = keep_agent_and_tool_ids(
                node_result.process_data,
                domain_execution.process_data,
            )

        self._workflow_node_execution_repository.save(domain_execution)
        self._workflow_node_execution_repository.save_execution_data(domain_execution)

    def _fail_running_node_executions(self, *, error_message: str) -> None:
        for tool_layer in self._workflow_tool_layers.values():
            self._prepare_workflow_tool_layer(tool_layer)
            tool_layer._fail_running_node_executions(error_message=error_message)
        now = naive_utc_now()
        for execution in self._node_execution_cache.values():
            if execution.status == WorkflowNodeExecutionStatus.RUNNING:
                execution.status = WorkflowNodeExecutionStatus.FAILED
                execution.error = error_message
                execution.finished_at = now
                execution.elapsed_time = max((now - execution.created_at).total_seconds(), 0.0)
                self._workflow_node_execution_repository.save(execution)

    def _system_variables(self) -> Mapping[str, Any]:
        runtime_state = self.runtime_state
        return runtime_state.variable_pool.get_by_prefix(SYSTEM_VARIABLE_NODE_ID)
