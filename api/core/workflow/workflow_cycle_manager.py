from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Union

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.app.task_pipeline.exc import WorkflowRunNotFoundError
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.workflow.entities import (
    WorkflowExecution,
    WorkflowNodeExecution,
)
from core.workflow.enums import (
    SystemVariableKey,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_entry import WorkflowEntry
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7


@dataclass
class CycleManagerWorkflowInfo:
    workflow_id: str
    workflow_type: WorkflowType
    version: str
    graph_data: Mapping[str, Any]


class WorkflowCycleManager:
    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
        workflow_system_variables: SystemVariable,
        workflow_info: CycleManagerWorkflowInfo,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ):
        self._application_generate_entity = application_generate_entity
        self._workflow_system_variables = workflow_system_variables
        self._workflow_info = workflow_info
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository

        # Initialize caches for workflow execution cycle
        # These caches avoid redundant repository calls during a single workflow execution
        self._workflow_execution_cache: dict[str, WorkflowExecution] = {}
        self._node_execution_cache: dict[str, WorkflowNodeExecution] = {}

    def handle_workflow_run_start(self) -> WorkflowExecution:
        inputs = self._prepare_workflow_inputs()
        execution_id = self._get_or_generate_execution_id()

        execution = WorkflowExecution.new(
            id_=execution_id,
            workflow_id=self._workflow_info.workflow_id,
            workflow_type=self._workflow_info.workflow_type,
            workflow_version=self._workflow_info.version,
            graph=self._workflow_info.graph_data,
            inputs=inputs,
            started_at=naive_utc_now(),
        )

        return self._save_and_cache_workflow_execution(execution)

    def handle_workflow_run_success(
        self,
        *,
        workflow_run_id: str,
        total_tokens: int,
        total_steps: int,
        outputs: Mapping[str, Any] | None = None,
        conversation_id: str | None = None,
        trace_manager: TraceQueueManager | None = None,
        external_trace_id: str | None = None,
    ) -> WorkflowExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_run_id)

        self._update_workflow_execution_completion(
            workflow_execution,
            status=WorkflowExecutionStatus.SUCCEEDED,
            outputs=outputs,
            total_tokens=total_tokens,
            total_steps=total_steps,
        )

        self._add_trace_task_if_needed(trace_manager, workflow_execution, conversation_id, external_trace_id)

        self._workflow_execution_repository.save(workflow_execution)
        return workflow_execution

    def handle_workflow_run_partial_success(
        self,
        *,
        workflow_run_id: str,
        total_tokens: int,
        total_steps: int,
        outputs: Mapping[str, Any] | None = None,
        exceptions_count: int = 0,
        conversation_id: str | None = None,
        trace_manager: TraceQueueManager | None = None,
        external_trace_id: str | None = None,
    ) -> WorkflowExecution:
        execution = self._get_workflow_execution_or_raise_error(workflow_run_id)

        self._update_workflow_execution_completion(
            execution,
            status=WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
            outputs=outputs,
            total_tokens=total_tokens,
            total_steps=total_steps,
            exceptions_count=exceptions_count,
        )

        self._add_trace_task_if_needed(trace_manager, execution, conversation_id, external_trace_id)

        self._workflow_execution_repository.save(execution)
        return execution

    def handle_workflow_run_failed(
        self,
        *,
        workflow_run_id: str,
        total_tokens: int,
        total_steps: int,
        status: WorkflowExecutionStatus,
        error_message: str,
        conversation_id: str | None = None,
        trace_manager: TraceQueueManager | None = None,
        exceptions_count: int = 0,
        external_trace_id: str | None = None,
    ) -> WorkflowExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_run_id)
        now = naive_utc_now()

        self._update_workflow_execution_completion(
            workflow_execution,
            status=status,
            total_tokens=total_tokens,
            total_steps=total_steps,
            error_message=error_message,
            exceptions_count=exceptions_count,
            finished_at=now,
        )

        self._fail_running_node_executions(workflow_execution.id_, error_message, now)
        self._add_trace_task_if_needed(trace_manager, workflow_execution, conversation_id, external_trace_id)

        self._workflow_execution_repository.save(workflow_execution)
        return workflow_execution

    def handle_node_execution_start(
        self,
        *,
        workflow_execution_id: str,
        event: QueueNodeStartedEvent,
    ) -> WorkflowNodeExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_execution_id)

        domain_execution = self._create_node_execution_from_event(
            workflow_execution=workflow_execution,
            event=event,
            status=WorkflowNodeExecutionStatus.RUNNING,
        )

        return self._save_and_cache_node_execution(domain_execution)

    def handle_workflow_node_execution_success(self, *, event: QueueNodeSucceededEvent) -> WorkflowNodeExecution:
        domain_execution = self._get_node_execution_from_cache(event.node_execution_id)

        self._update_node_execution_completion(
            domain_execution,
            event=event,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
        )

        self._workflow_node_execution_repository.save(domain_execution)
        self._workflow_node_execution_repository.save_execution_data(domain_execution)
        return domain_execution

    def handle_workflow_node_execution_failed(
        self,
        *,
        event: QueueNodeFailedEvent | QueueNodeExceptionEvent,
    ) -> WorkflowNodeExecution:
        """
        Workflow node execution failed
        :param event: queue node failed event
        :return:
        """
        domain_execution = self._get_node_execution_from_cache(event.node_execution_id)

        status = (
            WorkflowNodeExecutionStatus.EXCEPTION
            if isinstance(event, QueueNodeExceptionEvent)
            else WorkflowNodeExecutionStatus.FAILED
        )

        self._update_node_execution_completion(
            domain_execution,
            event=event,
            status=status,
            error=event.error,
            handle_special_values=True,
        )

        self._workflow_node_execution_repository.save(domain_execution)
        self._workflow_node_execution_repository.save_execution_data(domain_execution)
        return domain_execution

    def handle_workflow_node_execution_retried(
        self, *, workflow_execution_id: str, event: QueueNodeRetryEvent
    ) -> WorkflowNodeExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_execution_id)

        domain_execution = self._create_node_execution_from_event(
            workflow_execution=workflow_execution,
            event=event,
            status=WorkflowNodeExecutionStatus.RETRY,
            error=event.error,
            created_at=event.start_at,
        )

        # Handle inputs and outputs
        inputs = WorkflowEntry.handle_special_values(event.inputs)
        outputs = event.outputs
        metadata = self._merge_event_metadata(event)

        domain_execution.update_from_mapping(inputs=inputs, outputs=outputs, metadata=metadata)

        execution = self._save_and_cache_node_execution(domain_execution)
        self._workflow_node_execution_repository.save_execution_data(execution)
        return execution

    def _get_workflow_execution_or_raise_error(self, id: str, /) -> WorkflowExecution:
        # Check cache first
        if id in self._workflow_execution_cache:
            return self._workflow_execution_cache[id]

        raise WorkflowRunNotFoundError(id)

    def _prepare_workflow_inputs(self) -> dict[str, Any]:
        """Prepare workflow inputs by merging application inputs with system variables."""
        inputs = {**self._application_generate_entity.inputs}

        if self._workflow_system_variables:
            for field_name, value in self._workflow_system_variables.to_dict().items():
                if field_name != SystemVariableKey.CONVERSATION_ID:
                    inputs[f"sys.{field_name}"] = value

        return dict(WorkflowEntry.handle_special_values(inputs) or {})

    def _get_or_generate_execution_id(self) -> str:
        """Get execution ID from system variables or generate a new one."""
        if self._workflow_system_variables and self._workflow_system_variables.workflow_execution_id:
            return str(self._workflow_system_variables.workflow_execution_id)
        return str(uuidv7())

    def _save_and_cache_workflow_execution(self, execution: WorkflowExecution) -> WorkflowExecution:
        """Save workflow execution to repository and cache it."""
        self._workflow_execution_repository.save(execution)
        self._workflow_execution_cache[execution.id_] = execution
        return execution

    def _save_and_cache_node_execution(self, execution: WorkflowNodeExecution) -> WorkflowNodeExecution:
        """Save node execution to repository and cache it if it has an ID.

        This does not persist the `inputs` / `process_data` / `outputs` fields of the execution model.
        """
        self._workflow_node_execution_repository.save(execution)
        if execution.node_execution_id:
            self._node_execution_cache[execution.node_execution_id] = execution
        return execution

    def _get_node_execution_from_cache(self, node_execution_id: str) -> WorkflowNodeExecution:
        """Get node execution from cache or raise error if not found."""
        domain_execution = self._node_execution_cache.get(node_execution_id)
        if not domain_execution:
            raise ValueError(f"Domain node execution not found: {node_execution_id}")
        return domain_execution

    def _update_workflow_execution_completion(
        self,
        execution: WorkflowExecution,
        *,
        status: WorkflowExecutionStatus,
        total_tokens: int,
        total_steps: int,
        outputs: Mapping[str, Any] | None = None,
        error_message: str | None = None,
        exceptions_count: int = 0,
        finished_at: datetime | None = None,
    ):
        """Update workflow execution with completion data."""
        execution.status = status
        execution.outputs = outputs or {}
        execution.total_tokens = total_tokens
        execution.total_steps = total_steps
        execution.finished_at = finished_at or naive_utc_now()
        execution.exceptions_count = exceptions_count
        if error_message:
            execution.error_message = error_message

    def _add_trace_task_if_needed(
        self,
        trace_manager: TraceQueueManager | None,
        workflow_execution: WorkflowExecution,
        conversation_id: str | None,
        external_trace_id: str | None,
    ):
        """Add trace task if trace manager is provided."""
        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_execution=workflow_execution,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                    external_trace_id=external_trace_id,
                )
            )

    def _fail_running_node_executions(
        self,
        workflow_execution_id: str,
        error_message: str,
        now: datetime,
    ):
        """Fail all running node executions for a workflow."""
        running_node_executions = [
            node_exec
            for node_exec in self._node_execution_cache.values()
            if node_exec.workflow_execution_id == workflow_execution_id
            and node_exec.status == WorkflowNodeExecutionStatus.RUNNING
        ]

        for node_execution in running_node_executions:
            if node_execution.node_execution_id:
                node_execution.status = WorkflowNodeExecutionStatus.FAILED
                node_execution.error = error_message
                node_execution.finished_at = now
                node_execution.elapsed_time = (now - node_execution.created_at).total_seconds()
                self._workflow_node_execution_repository.save(node_execution)

    def _create_node_execution_from_event(
        self,
        *,
        workflow_execution: WorkflowExecution,
        event: QueueNodeStartedEvent,
        status: WorkflowNodeExecutionStatus,
        error: str | None = None,
        created_at: datetime | None = None,
    ) -> WorkflowNodeExecution:
        """Create a node execution from an event."""
        now = naive_utc_now()
        created_at = created_at or now

        metadata = {
            WorkflowNodeExecutionMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: event.in_iteration_id,
            WorkflowNodeExecutionMetadataKey.LOOP_ID: event.in_loop_id,
        }

        domain_execution = WorkflowNodeExecution(
            id=event.node_execution_id,
            workflow_id=workflow_execution.workflow_id,
            workflow_execution_id=workflow_execution.id_,
            predecessor_node_id=event.predecessor_node_id,
            index=event.node_run_index,
            node_execution_id=event.node_execution_id,
            node_id=event.node_id,
            node_type=event.node_type,
            title=event.node_title,
            status=status,
            metadata=metadata,
            created_at=created_at,
            error=error,
        )

        if status == WorkflowNodeExecutionStatus.RETRY:
            domain_execution.finished_at = now
            domain_execution.elapsed_time = (now - created_at).total_seconds()

        return domain_execution

    def _update_node_execution_completion(
        self,
        domain_execution: WorkflowNodeExecution,
        *,
        event: Union[
            QueueNodeSucceededEvent,
            QueueNodeFailedEvent,
            QueueNodeExceptionEvent,
        ],
        status: WorkflowNodeExecutionStatus,
        error: str | None = None,
        handle_special_values: bool = False,
    ):
        """Update node execution with completion data."""
        finished_at = naive_utc_now()
        elapsed_time = (finished_at - event.start_at).total_seconds()

        # Process data
        if handle_special_values:
            inputs = WorkflowEntry.handle_special_values(event.inputs)
            process_data = WorkflowEntry.handle_special_values(event.process_data)
        else:
            inputs = event.inputs
            process_data = event.process_data

        outputs = event.outputs

        # Convert metadata
        execution_metadata_dict: dict[WorkflowNodeExecutionMetadataKey, Any] = {}
        if event.execution_metadata:
            execution_metadata_dict.update(event.execution_metadata)

        # Update domain model
        domain_execution.status = status
        domain_execution.update_from_mapping(
            inputs=inputs,
            process_data=process_data,
            outputs=outputs,
            metadata=execution_metadata_dict,
        )
        domain_execution.finished_at = finished_at
        domain_execution.elapsed_time = elapsed_time

        if error:
            domain_execution.error = error

    def _merge_event_metadata(self, event: QueueNodeRetryEvent) -> dict[WorkflowNodeExecutionMetadataKey, str | None]:
        """Merge event metadata with origin metadata."""
        origin_metadata = {
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: event.in_iteration_id,
            WorkflowNodeExecutionMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
            WorkflowNodeExecutionMetadataKey.LOOP_ID: event.in_loop_id,
        }

        execution_metadata_dict: dict[WorkflowNodeExecutionMetadataKey, str | None] = {}
        if event.execution_metadata:
            execution_metadata_dict.update(event.execution_metadata)

        return {**execution_metadata_dict, **origin_metadata} if execution_metadata_dict else origin_metadata
