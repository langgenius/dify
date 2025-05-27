from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Optional, Union
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

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
from core.workflow.entities.node_entities import NodeRunMetadataKey
from core.workflow.entities.node_execution_entities import (
    NodeExecution,
    NodeExecutionStatus,
)
from core.workflow.entities.workflow_execution_entities import WorkflowExecution, WorkflowExecutionStatus, WorkflowType
from core.workflow.enums import SystemVariableKey
from core.workflow.repository.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repository.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.workflow_entry import WorkflowEntry
from models import (
    Workflow,
    WorkflowRun,
    WorkflowRunStatus,
)


class WorkflowCycleManager:
    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
        workflow_system_variables: dict[SystemVariableKey, Any],
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ) -> None:
        self._application_generate_entity = application_generate_entity
        self._workflow_system_variables = workflow_system_variables
        self._workflow_execution_repository = workflow_execution_repository
        self._workflow_node_execution_repository = workflow_node_execution_repository

    def handle_workflow_run_start(
        self,
        *,
        session: Session,
        workflow_id: str,
    ) -> WorkflowExecution:
        workflow_stmt = select(Workflow).where(Workflow.id == workflow_id)
        workflow = session.scalar(workflow_stmt)
        if not workflow:
            raise ValueError(f"Workflow not found: {workflow_id}")

        max_sequence_stmt = select(func.max(WorkflowRun.sequence_number)).where(
            WorkflowRun.tenant_id == workflow.tenant_id,
            WorkflowRun.app_id == workflow.app_id,
        )
        max_sequence = session.scalar(max_sequence_stmt) or 0
        new_sequence_number = max_sequence + 1

        inputs = {**self._application_generate_entity.inputs}
        for key, value in (self._workflow_system_variables or {}).items():
            if key.value == "conversation":
                continue
            inputs[f"sys.{key.value}"] = value

        # handle special values
        inputs = dict(WorkflowEntry.handle_special_values(inputs) or {})

        # init workflow run
        # TODO: This workflow_run_id should always not be None, maybe we can use a more elegant way to handle this
        execution_id = str(self._workflow_system_variables.get(SystemVariableKey.WORKFLOW_RUN_ID) or uuid4())
        execution = WorkflowExecution.new(
            id=execution_id,
            workflow_id=workflow.id,
            sequence_number=new_sequence_number,
            type=WorkflowType(workflow.type),
            workflow_version=workflow.version,
            graph=workflow.graph_dict,
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

        outputs = WorkflowEntry.handle_special_values(outputs)

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
        outputs = WorkflowEntry.handle_special_values(dict(outputs) if outputs else None)

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
        status: WorkflowRunStatus,
        error_message: str,
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
        exceptions_count: int = 0,
    ) -> WorkflowExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_run_id)

        workflow_execution.status = WorkflowExecutionStatus(status.value)
        workflow_execution.error_message = error_message
        workflow_execution.total_tokens = total_tokens
        workflow_execution.total_steps = total_steps
        workflow_execution.finished_at = datetime.now(UTC).replace(tzinfo=None)
        workflow_execution.exceptions_count = exceptions_count

        # Use the instance repository to find running executions for a workflow run
        running_node_executions = self._workflow_node_execution_repository.get_running_executions(
            workflow_run_id=workflow_execution.id
        )

        # Update the domain models
        now = datetime.now(UTC).replace(tzinfo=None)
        for node_execution in running_node_executions:
            if node_execution.node_execution_id:
                # Update the domain model
                node_execution.status = NodeExecutionStatus.FAILED
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
    ) -> NodeExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_execution_id)

        # Create a domain model
        created_at = datetime.now(UTC).replace(tzinfo=None)
        metadata = {
            NodeRunMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
            NodeRunMetadataKey.ITERATION_ID: event.in_iteration_id,
            NodeRunMetadataKey.LOOP_ID: event.in_loop_id,
        }

        domain_execution = NodeExecution(
            id=str(uuid4()),
            workflow_id=workflow_execution.workflow_id,
            workflow_run_id=workflow_execution.id,
            predecessor_node_id=event.predecessor_node_id,
            index=event.node_run_index,
            node_execution_id=event.node_execution_id,
            node_id=event.node_id,
            node_type=event.node_type,
            title=event.node_data.title,
            status=NodeExecutionStatus.RUNNING,
            metadata=metadata,
            created_at=created_at,
        )

        # Use the instance repository to save the domain model
        self._workflow_node_execution_repository.save(domain_execution)

        return domain_execution

    def handle_workflow_node_execution_success(self, *, event: QueueNodeSucceededEvent) -> NodeExecution:
        # Get the domain model from repository
        domain_execution = self._workflow_node_execution_repository.get_by_node_execution_id(event.node_execution_id)
        if not domain_execution:
            raise ValueError(f"Domain node execution not found: {event.node_execution_id}")

        # Process data
        inputs = WorkflowEntry.handle_special_values(event.inputs)
        process_data = WorkflowEntry.handle_special_values(event.process_data)
        outputs = WorkflowEntry.handle_special_values(event.outputs)

        # Convert metadata keys to strings
        execution_metadata_dict = {}
        if event.execution_metadata:
            for key, value in event.execution_metadata.items():
                execution_metadata_dict[key] = value

        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - event.start_at).total_seconds()

        # Update domain model
        domain_execution.status = NodeExecutionStatus.SUCCEEDED
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
    ) -> NodeExecution:
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
        outputs = WorkflowEntry.handle_special_values(event.outputs)

        # Convert metadata keys to strings
        execution_metadata_dict = {}
        if event.execution_metadata:
            for key, value in event.execution_metadata.items():
                execution_metadata_dict[key] = value

        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - event.start_at).total_seconds()

        # Update domain model
        domain_execution.status = (
            NodeExecutionStatus.FAILED
            if not isinstance(event, QueueNodeExceptionEvent)
            else NodeExecutionStatus.EXCEPTION
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
    ) -> NodeExecution:
        workflow_execution = self._get_workflow_execution_or_raise_error(workflow_execution_id)
        created_at = event.start_at
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - created_at).total_seconds()
        inputs = WorkflowEntry.handle_special_values(event.inputs)
        outputs = WorkflowEntry.handle_special_values(event.outputs)

        # Convert metadata keys to strings
        origin_metadata = {
            NodeRunMetadataKey.ITERATION_ID: event.in_iteration_id,
            NodeRunMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
            NodeRunMetadataKey.LOOP_ID: event.in_loop_id,
        }

        # Convert execution metadata keys to strings
        execution_metadata_dict: dict[NodeRunMetadataKey, str | None] = {}
        if event.execution_metadata:
            for key, value in event.execution_metadata.items():
                execution_metadata_dict[key] = value

        merged_metadata = {**execution_metadata_dict, **origin_metadata} if execution_metadata_dict else origin_metadata

        # Create a domain model
        domain_execution = NodeExecution(
            id=str(uuid4()),
            workflow_id=workflow_execution.workflow_id,
            workflow_run_id=workflow_execution.id,
            predecessor_node_id=event.predecessor_node_id,
            node_execution_id=event.node_execution_id,
            node_id=event.node_id,
            node_type=event.node_type,
            title=event.node_data.title,
            status=NodeExecutionStatus.RETRY,
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
