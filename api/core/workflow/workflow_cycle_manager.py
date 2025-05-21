import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Optional, Union, cast
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueAgentLogEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeInIterationFailedEvent,
    QueueNodeInLoopFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueParallelBranchRunFailedEvent,
    QueueParallelBranchRunStartedEvent,
    QueueParallelBranchRunSucceededEvent,
)
from core.app.entities.task_entities import (
    AgentLogStreamResponse,
    IterationNodeCompletedStreamResponse,
    IterationNodeNextStreamResponse,
    IterationNodeStartStreamResponse,
    LoopNodeCompletedStreamResponse,
    LoopNodeNextStreamResponse,
    LoopNodeStartStreamResponse,
    NodeFinishStreamResponse,
    NodeRetryStreamResponse,
    NodeStartStreamResponse,
    ParallelBranchFinishedStreamResponse,
    ParallelBranchStartStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
)
from core.app.task_pipeline.exc import WorkflowRunNotFoundError
from core.file import FILE_MODEL_IDENTITY, File
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.tools.tool_manager import ToolManager
from core.workflow.entities.node_entities import NodeRunMetadataKey
from core.workflow.entities.node_execution_entities import (
    NodeExecution,
    NodeExecutionStatus,
)
from core.workflow.entities.workflow_execution_entities import WorkflowExecution, WorkflowExecutionStatus, WorkflowType
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes import NodeType
from core.workflow.nodes.tool.entities import ToolNodeData
from core.workflow.repository.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.repository.workflow_node_execution_repository import WorkflowNodeExecutionRepository
from core.workflow.workflow_entry import WorkflowEntry
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    Workflow,
    WorkflowNodeExecutionStatus,
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
        execution = self._get_workflow_execution_or_raise_error(workflow_run_id)

        execution.status = WorkflowExecutionStatus(status.value)
        execution.error_message = error_message
        execution.total_tokens = total_tokens
        execution.total_steps = total_steps
        execution.finished_at = datetime.now(UTC).replace(tzinfo=None)
        execution.exceptions_count = exceptions_count

        # Use the instance repository to find running executions for a workflow run
        running_domain_executions = self._workflow_node_execution_repository.get_running_executions(
            workflow_run_id=execution.id
        )

        # Update the domain models
        now = datetime.now(UTC).replace(tzinfo=None)
        for domain_execution in running_domain_executions:
            if domain_execution.node_execution_id:
                # Update the domain model
                domain_execution.status = NodeExecutionStatus.FAILED
                domain_execution.error = error_message
                domain_execution.finished_at = now
                domain_execution.elapsed_time = (now - domain_execution.created_at).total_seconds()

                # Update the repository with the domain model
                self._workflow_node_execution_repository.save(domain_execution)

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_execution=execution,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

        return execution

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

    def workflow_start_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution: WorkflowExecution,
    ) -> WorkflowStartStreamResponse:
        return WorkflowStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution.id,
            data=WorkflowStartStreamResponse.Data(
                id=workflow_execution.id,
                workflow_id=workflow_execution.workflow_id,
                sequence_number=workflow_execution.sequence_number,
                inputs=workflow_execution.inputs,
                created_at=int(workflow_execution.started_at.timestamp()),
            ),
        )

    def workflow_finish_to_stream_response(
        self,
        *,
        session: Session,
        task_id: str,
        workflow_execution: WorkflowExecution,
    ) -> WorkflowFinishStreamResponse:
        created_by = None
        workflow_run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == workflow_execution.id))
        assert workflow_run is not None
        if workflow_run.created_by_role == CreatorUserRole.ACCOUNT:
            stmt = select(Account).where(Account.id == workflow_run.created_by)
            account = session.scalar(stmt)
            if account:
                created_by = {
                    "id": account.id,
                    "name": account.name,
                    "email": account.email,
                }
        elif workflow_run.created_by_role == CreatorUserRole.END_USER:
            stmt = select(EndUser).where(EndUser.id == workflow_run.created_by)
            end_user = session.scalar(stmt)
            if end_user:
                created_by = {
                    "id": end_user.id,
                    "user": end_user.session_id,
                }
        else:
            raise NotImplementedError(f"unknown created_by_role: {workflow_run.created_by_role}")

        # Handle the case where finished_at is None by using current time as default
        finished_at_timestamp = (
            int(workflow_execution.finished_at.timestamp())
            if workflow_execution.finished_at
            else int(datetime.now(UTC).timestamp())
        )

        return WorkflowFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution.id,
            data=WorkflowFinishStreamResponse.Data(
                id=workflow_execution.id,
                workflow_id=workflow_execution.workflow_id,
                sequence_number=workflow_execution.sequence_number,
                status=workflow_execution.status,
                outputs=workflow_execution.outputs,
                error=workflow_execution.error_message,
                elapsed_time=workflow_execution.elapsed_time,
                total_tokens=workflow_execution.total_tokens,
                total_steps=workflow_execution.total_steps,
                created_by=created_by,
                created_at=int(workflow_execution.started_at.timestamp()),
                finished_at=finished_at_timestamp,
                files=self.fetch_files_from_node_outputs(workflow_execution.outputs),
                exceptions_count=workflow_execution.exceptions_count,
            ),
        )

    def workflow_node_start_to_stream_response(
        self,
        *,
        event: QueueNodeStartedEvent,
        task_id: str,
        workflow_node_execution: NodeExecution,
    ) -> Optional[NodeStartStreamResponse]:
        if workflow_node_execution.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        if not workflow_node_execution.workflow_run_id:
            return None

        response = NodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_node_execution.workflow_run_id,
            data=NodeStartStreamResponse.Data(
                id=workflow_node_execution.id,
                node_id=workflow_node_execution.node_id,
                node_type=workflow_node_execution.node_type,
                title=workflow_node_execution.title,
                index=workflow_node_execution.index,
                predecessor_node_id=workflow_node_execution.predecessor_node_id,
                inputs=workflow_node_execution.inputs,
                created_at=int(workflow_node_execution.created_at.timestamp()),
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
                parallel_run_id=event.parallel_mode_run_id,
                agent_strategy=event.agent_strategy,
            ),
        )

        # extras logic
        if event.node_type == NodeType.TOOL:
            node_data = cast(ToolNodeData, event.node_data)
            response.data.extras["icon"] = ToolManager.get_tool_icon(
                tenant_id=self._application_generate_entity.app_config.tenant_id,
                provider_type=node_data.provider_type,
                provider_id=node_data.provider_id,
            )

        return response

    def workflow_node_finish_to_stream_response(
        self,
        *,
        event: QueueNodeSucceededEvent
        | QueueNodeFailedEvent
        | QueueNodeInIterationFailedEvent
        | QueueNodeInLoopFailedEvent
        | QueueNodeExceptionEvent,
        task_id: str,
        workflow_node_execution: NodeExecution,
    ) -> Optional[NodeFinishStreamResponse]:
        if workflow_node_execution.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        if not workflow_node_execution.workflow_run_id:
            return None
        if not workflow_node_execution.finished_at:
            return None

        return NodeFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_node_execution.workflow_run_id,
            data=NodeFinishStreamResponse.Data(
                id=workflow_node_execution.id,
                node_id=workflow_node_execution.node_id,
                node_type=workflow_node_execution.node_type,
                index=workflow_node_execution.index,
                title=workflow_node_execution.title,
                predecessor_node_id=workflow_node_execution.predecessor_node_id,
                inputs=workflow_node_execution.inputs,
                process_data=workflow_node_execution.process_data,
                outputs=workflow_node_execution.outputs,
                status=workflow_node_execution.status,
                error=workflow_node_execution.error,
                elapsed_time=workflow_node_execution.elapsed_time,
                execution_metadata=workflow_node_execution.metadata,
                created_at=int(workflow_node_execution.created_at.timestamp()),
                finished_at=int(workflow_node_execution.finished_at.timestamp()),
                files=self.fetch_files_from_node_outputs(workflow_node_execution.outputs or {}),
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
            ),
        )

    def workflow_node_retry_to_stream_response(
        self,
        *,
        event: QueueNodeRetryEvent,
        task_id: str,
        workflow_node_execution: NodeExecution,
    ) -> Optional[Union[NodeRetryStreamResponse, NodeFinishStreamResponse]]:
        if workflow_node_execution.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        if not workflow_node_execution.workflow_run_id:
            return None
        if not workflow_node_execution.finished_at:
            return None

        return NodeRetryStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_node_execution.workflow_run_id,
            data=NodeRetryStreamResponse.Data(
                id=workflow_node_execution.id,
                node_id=workflow_node_execution.node_id,
                node_type=workflow_node_execution.node_type,
                index=workflow_node_execution.index,
                title=workflow_node_execution.title,
                predecessor_node_id=workflow_node_execution.predecessor_node_id,
                inputs=workflow_node_execution.inputs,
                process_data=workflow_node_execution.process_data,
                outputs=workflow_node_execution.outputs,
                status=workflow_node_execution.status,
                error=workflow_node_execution.error,
                elapsed_time=workflow_node_execution.elapsed_time,
                execution_metadata=workflow_node_execution.metadata,
                created_at=int(workflow_node_execution.created_at.timestamp()),
                finished_at=int(workflow_node_execution.finished_at.timestamp()),
                files=self.fetch_files_from_node_outputs(workflow_node_execution.outputs or {}),
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
                retry_index=event.retry_index,
            ),
        )

    def workflow_parallel_branch_start_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueParallelBranchRunStartedEvent,
    ) -> ParallelBranchStartStreamResponse:
        return ParallelBranchStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=ParallelBranchStartStreamResponse.Data(
                parallel_id=event.parallel_id,
                parallel_branch_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
                created_at=int(time.time()),
            ),
        )

    def workflow_parallel_branch_finished_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueParallelBranchRunSucceededEvent | QueueParallelBranchRunFailedEvent,
    ) -> ParallelBranchFinishedStreamResponse:
        return ParallelBranchFinishedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=ParallelBranchFinishedStreamResponse.Data(
                parallel_id=event.parallel_id,
                parallel_branch_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
                status="succeeded" if isinstance(event, QueueParallelBranchRunSucceededEvent) else "failed",
                error=event.error if isinstance(event, QueueParallelBranchRunFailedEvent) else None,
                created_at=int(time.time()),
            ),
        )

    def workflow_iteration_start_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueIterationStartEvent,
    ) -> IterationNodeStartStreamResponse:
        return IterationNodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=IterationNodeStartStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_data.title,
                created_at=int(time.time()),
                extras={},
                inputs=event.inputs or {},
                metadata=event.metadata or {},
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
            ),
        )

    def workflow_iteration_next_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueIterationNextEvent,
    ) -> IterationNodeNextStreamResponse:
        return IterationNodeNextStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=IterationNodeNextStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_data.title,
                index=event.index,
                pre_iteration_output=event.output,
                created_at=int(time.time()),
                extras={},
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
                parallel_mode_run_id=event.parallel_mode_run_id,
                duration=event.duration,
            ),
        )

    def workflow_iteration_completed_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueIterationCompletedEvent,
    ) -> IterationNodeCompletedStreamResponse:
        return IterationNodeCompletedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=IterationNodeCompletedStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_data.title,
                outputs=event.outputs,
                created_at=int(time.time()),
                extras={},
                inputs=event.inputs or {},
                status=WorkflowNodeExecutionStatus.SUCCEEDED
                if event.error is None
                else WorkflowNodeExecutionStatus.FAILED,
                error=None,
                elapsed_time=(datetime.now(UTC).replace(tzinfo=None) - event.start_at).total_seconds(),
                total_tokens=event.metadata.get("total_tokens", 0) if event.metadata else 0,
                execution_metadata=event.metadata,
                finished_at=int(time.time()),
                steps=event.steps,
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
            ),
        )

    def workflow_loop_start_to_stream_response(
        self, *, task_id: str, workflow_execution_id: str, event: QueueLoopStartEvent
    ) -> LoopNodeStartStreamResponse:
        return LoopNodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=LoopNodeStartStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_data.title,
                created_at=int(time.time()),
                extras={},
                inputs=event.inputs or {},
                metadata=event.metadata or {},
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
            ),
        )

    def workflow_loop_next_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueLoopNextEvent,
    ) -> LoopNodeNextStreamResponse:
        return LoopNodeNextStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=LoopNodeNextStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_data.title,
                index=event.index,
                pre_loop_output=event.output,
                created_at=int(time.time()),
                extras={},
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
                parallel_mode_run_id=event.parallel_mode_run_id,
                duration=event.duration,
            ),
        )

    def workflow_loop_completed_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution_id: str,
        event: QueueLoopCompletedEvent,
    ) -> LoopNodeCompletedStreamResponse:
        return LoopNodeCompletedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=LoopNodeCompletedStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_data.title,
                outputs=event.outputs,
                created_at=int(time.time()),
                extras={},
                inputs=event.inputs or {},
                status=WorkflowNodeExecutionStatus.SUCCEEDED
                if event.error is None
                else WorkflowNodeExecutionStatus.FAILED,
                error=None,
                elapsed_time=(datetime.now(UTC).replace(tzinfo=None) - event.start_at).total_seconds(),
                total_tokens=event.metadata.get("total_tokens", 0) if event.metadata else 0,
                execution_metadata=event.metadata,
                finished_at=int(time.time()),
                steps=event.steps,
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
            ),
        )

    def fetch_files_from_node_outputs(self, outputs_dict: Mapping[str, Any] | None) -> Sequence[Mapping[str, Any]]:
        """
        Fetch files from node outputs
        :param outputs_dict: node outputs dict
        :return:
        """
        if not outputs_dict:
            return []

        files = [self._fetch_files_from_variable_value(output_value) for output_value in outputs_dict.values()]
        # Remove None
        files = [file for file in files if file]
        # Flatten list
        # Flatten the list of sequences into a single list of mappings
        flattened_files = [file for sublist in files if sublist for file in sublist]

        # Convert to tuple to match Sequence type
        return tuple(flattened_files)

    def _fetch_files_from_variable_value(self, value: Union[dict, list]) -> Sequence[Mapping[str, Any]]:
        """
        Fetch files from variable value
        :param value: variable value
        :return:
        """
        if not value:
            return []

        files = []
        if isinstance(value, list):
            for item in value:
                file = self._get_file_var_from_value(item)
                if file:
                    files.append(file)
        elif isinstance(value, dict):
            file = self._get_file_var_from_value(value)
            if file:
                files.append(file)

        return files

    def _get_file_var_from_value(self, value: Union[dict, list]) -> Mapping[str, Any] | None:
        """
        Get file var from value
        :param value: variable value
        :return:
        """
        if not value:
            return None

        if isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
            return value
        elif isinstance(value, File):
            return value.to_dict()

        return None

    def _get_workflow_execution_or_raise_error(self, id: str, /) -> WorkflowExecution:
        execution = self._workflow_execution_repository.get(id)
        if not execution:
            raise WorkflowRunNotFoundError(id)
        return execution

    def handle_agent_log(self, task_id: str, event: QueueAgentLogEvent) -> AgentLogStreamResponse:
        """
        Handle agent log
        :param task_id: task id
        :param event: agent log event
        :return:
        """
        return AgentLogStreamResponse(
            task_id=task_id,
            data=AgentLogStreamResponse.Data(
                node_execution_id=event.node_execution_id,
                id=event.id,
                parent_id=event.parent_id,
                label=event.label,
                error=event.error,
                status=event.status,
                data=event.data,
                metadata=event.metadata,
                node_id=event.node_id,
            ),
        )
