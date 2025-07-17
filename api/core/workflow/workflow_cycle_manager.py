from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Optional, Union
from uuid import uuid4

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeInIterationFailedEvent,
    QueueNodeInLoopFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.app.task_pipeline.exc import WorkflowRunNotFoundError
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.workflow.entities.workflow_execution import WorkflowExecution, WorkflowExecutionStatus, WorkflowType
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.enums import SystemVariableKey
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repositories.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.system_variable import SystemVariable
from core.workflow.workflow_entry import WorkflowEntry
from libs.datetime_utils import naive_utc_now


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
    ) -> None:
        self._application_generate_entity = application_generate_entity
        self._workflow_system_variables = workflow_system_variables
        self._workflow_info = workflow_info
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository

    def handle_workflow_run_start(self) -> WorkflowExecution:
        inputs = {**self._application_generate_entity.inputs}

        # Iterate over SystemVariable fields using Pydantic's model_fields
        if self._workflow_system_variables:
            for field_name, value in self._workflow_system_variables.to_dict().items():
                if field_name == SystemVariableKey.CONVERSATION_ID:
                    continue
                inputs[f"sys.{field_name}"] = value

        # handle special values
        inputs = dict(WorkflowEntry.handle_special_values(inputs) or {})

        # init workflow run
        # TODO: This workflow_run_id should always not be None, maybe we can use a more elegant way to handle this
        execution_id = str(
            self._workflow_system_variables.workflow_execution_id if self._workflow_system_variables else None
        ) or str(uuid4())
        execution = WorkflowExecution.new(
            id_=execution_id,
            workflow_id=self._workflow_info.workflow_id,
            workflow_type=self._workflow_info.workflow_type,
            workflow_version=self._workflow_info.version,
            graph=self._workflow_info.graph_data,
            inputs=inputs,
            started_at=datetime.now(UTC).replace(tzinfo=None),
        )

        self._workflow_execution_repository.save(execution)

        return execution

    def handle_workflow_run_success(
        self,
        *,
        workflow_run_id: str,
        total_tokens: int,
        total_steps: int,
        outputs: Mapping[str, Any] | None = None,
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> WorkflowExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_run_id)

        # outputs = WorkflowEntry.handle_special_values(outputs)

        workflow_execution.status = WorkflowExecutionStatus.SUCCEEDED
        workflow_execution.outputs = outputs or {}
        workflow_execution.total_tokens = total_tokens
        workflow_execution.total_steps = total_steps
        workflow_execution.finished_at = datetime.now(UTC).replace(tzinfo=None)

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_execution=workflow_execution,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

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
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> WorkflowExecution:
        execution = self._get_workflow_execution_or_raise_error(workflow_run_id)
        # outputs = WorkflowEntry.handle_special_values(dict(outputs) if outputs else None)

        execution.status = WorkflowExecutionStatus.PARTIAL_SUCCEEDED
        execution.outputs = outputs or {}
        execution.total_tokens = total_tokens
        execution.total_steps = total_steps
        execution.finished_at = datetime.now(UTC).replace(tzinfo=None)
        execution.exceptions_count = exceptions_count

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_execution=execution,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

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
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
        exceptions_count: int = 0,
    ) -> WorkflowExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_run_id)
        now = naive_utc_now()

        workflow_execution.status = WorkflowExecutionStatus(status.value)
        workflow_execution.error_message = error_message
        workflow_execution.total_tokens = total_tokens
        workflow_execution.total_steps = total_steps
        workflow_execution.finished_at = now
        workflow_execution.exceptions_count = exceptions_count

        # Use the instance repository to find running executions for a workflow run
        running_node_executions = self._workflow_node_execution_repository.get_running_executions(
            workflow_run_id=workflow_execution.id_
        )

        # Update the domain models
        for node_execution in running_node_executions:
            if node_execution.node_execution_id:
                # Update the domain model
                node_execution.status = WorkflowNodeExecutionStatus.FAILED
                node_execution.error = error_message
                node_execution.finished_at = now
                node_execution.elapsed_time = (now - node_execution.created_at).total_seconds()

                # Update the repository with the domain model
                self._workflow_node_execution_repository.save(node_execution)

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_execution=workflow_execution,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

        self._workflow_execution_repository.save(workflow_execution)
        return workflow_execution

    def handle_node_execution_start(
        self,
        *,
        workflow_execution_id: str,
        event: QueueNodeStartedEvent,
    ) -> WorkflowNodeExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_execution_id)

        # Create a domain model
        created_at = datetime.now(UTC).replace(tzinfo=None)
        metadata = {
            WorkflowNodeExecutionMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: event.in_iteration_id,
            WorkflowNodeExecutionMetadataKey.LOOP_ID: event.in_loop_id,
        }

        domain_execution = WorkflowNodeExecution(
            id=str(uuid4()),
            workflow_id=workflow_execution.workflow_id,
            workflow_execution_id=workflow_execution.id_,
            predecessor_node_id=event.predecessor_node_id,
            index=event.node_run_index,
            node_execution_id=event.node_execution_id,
            node_id=event.node_id,
            node_type=event.node_type,
            title=event.node_data.title,
            status=WorkflowNodeExecutionStatus.RUNNING,
            metadata=metadata,
            created_at=created_at,
        )

        # Use the instance repository to save the domain model
        self._workflow_node_execution_repository.save(domain_execution)

        return domain_execution

    def handle_workflow_node_execution_success(self, *, event: QueueNodeSucceededEvent) -> WorkflowNodeExecution:
        # Get the domain model from repository
        domain_execution = self._workflow_node_execution_repository.get_by_node_execution_id(event.node_execution_id)
        if not domain_execution:
            raise ValueError(f"Domain node execution not found: {event.node_execution_id}")

        # Process data
        inputs = event.inputs
        process_data = event.process_data
        outputs = event.outputs

        # Convert metadata keys to strings
        execution_metadata_dict = {}
        if event.execution_metadata:
            for key, value in event.execution_metadata.items():
                execution_metadata_dict[key] = value

        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - event.start_at).total_seconds()

        # Update domain model
        domain_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        domain_execution.update_from_mapping(
            inputs=inputs, process_data=process_data, outputs=outputs, metadata=execution_metadata_dict
        )
        domain_execution.finished_at = finished_at
        domain_execution.elapsed_time = elapsed_time

        # Update the repository with the domain model
        self._workflow_node_execution_repository.save(domain_execution)

        return domain_execution

    def handle_workflow_node_execution_failed(
        self,
        *,
        event: QueueNodeFailedEvent
        | QueueNodeInIterationFailedEvent
        | QueueNodeInLoopFailedEvent
        | QueueNodeExceptionEvent,
    ) -> WorkflowNodeExecution:
        """
        Workflow node execution failed
        :param event: queue node failed event
        :return:
        """
        # Get the domain model from repository
        domain_execution = self._workflow_node_execution_repository.get_by_node_execution_id(event.node_execution_id)
        if not domain_execution:
            raise ValueError(f"Domain node execution not found: {event.node_execution_id}")

        # Process data
        inputs = WorkflowEntry.handle_special_values(event.inputs)
        process_data = WorkflowEntry.handle_special_values(event.process_data)
        outputs = event.outputs

        # Convert metadata keys to strings
        execution_metadata_dict = {}
        if event.execution_metadata:
            for key, value in event.execution_metadata.items():
                execution_metadata_dict[key] = value

        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - event.start_at).total_seconds()

        # Update domain model
        domain_execution.status = (
            WorkflowNodeExecutionStatus.FAILED
            if not isinstance(event, QueueNodeExceptionEvent)
            else WorkflowNodeExecutionStatus.EXCEPTION
        )
        domain_execution.error = event.error
        domain_execution.update_from_mapping(
            inputs=inputs, process_data=process_data, outputs=outputs, metadata=execution_metadata_dict
        )
        domain_execution.finished_at = finished_at
        domain_execution.elapsed_time = elapsed_time

        # Update the repository with the domain model
        self._workflow_node_execution_repository.save(domain_execution)

        return domain_execution

    def handle_workflow_node_execution_retried(
        self, *, workflow_execution_id: str, event: QueueNodeRetryEvent
    ) -> WorkflowNodeExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_execution_id)
        created_at = event.start_at
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - created_at).total_seconds()
        inputs = WorkflowEntry.handle_special_values(event.inputs)
        outputs = event.outputs

        # Convert metadata keys to strings
        origin_metadata = {
            WorkflowNodeExecutionMetadataKey.ITERATION_ID: event.in_iteration_id,
            WorkflowNodeExecutionMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
            WorkflowNodeExecutionMetadataKey.LOOP_ID: event.in_loop_id,
        }

        # Convert execution metadata keys to strings
        execution_metadata_dict: dict[WorkflowNodeExecutionMetadataKey, str | None] = {}
        if event.execution_metadata:
            for key, value in event.execution_metadata.items():
                execution_metadata_dict[key] = value

        merged_metadata = {**execution_metadata_dict, **origin_metadata} if execution_metadata_dict else origin_metadata

        # Create a domain model
        domain_execution = WorkflowNodeExecution(
            id=str(uuid4()),
            workflow_id=workflow_execution.workflow_id,
            workflow_execution_id=workflow_execution.id_,
            predecessor_node_id=event.predecessor_node_id,
            node_execution_id=event.node_execution_id,
            node_id=event.node_id,
            node_type=event.node_type,
            title=event.node_data.title,
            status=WorkflowNodeExecutionStatus.RETRY,
            created_at=created_at,
            finished_at=finished_at,
            elapsed_time=elapsed_time,
            error=event.error,
            index=event.node_run_index,
        )

        # Update with mappings
        domain_execution.update_from_mapping(inputs=inputs, outputs=outputs, metadata=merged_metadata)

        # Use the instance repository to save the domain model
        self._workflow_node_execution_repository.save(domain_execution)

        return domain_execution

    def _get_workflow_execution_or_raise_error(self, id: str, /) -> WorkflowExecution:
        execution = self._workflow_execution_repository.get(id)
        if not execution:
            raise WorkflowRunNotFoundError(id)
        return execution
