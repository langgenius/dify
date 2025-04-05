import json
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Optional, Union, cast
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
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
from core.model_runtime.utils.encoders import jsonable_encoder
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.tools.tool_manager import ToolManager
from core.workflow.entities.node_entities import NodeRunMetadataKey
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes import NodeType
from core.workflow.nodes.tool.entities import ToolNodeData
from core.workflow.workflow_entry import WorkflowEntry
from models.account import Account
from models.enums import CreatedByRole, WorkflowRunTriggeredFrom
from models.model import EndUser
from models.workflow import (
    Workflow,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunStatus,
)


class WorkflowCycleManage:
    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
        workflow_system_variables: dict[SystemVariableKey, Any],
    ) -> None:
        self._workflow_run: WorkflowRun | None = None
        self._workflow_node_executions: dict[str, WorkflowNodeExecution] = {}
        self._application_generate_entity = application_generate_entity
        self._workflow_system_variables = workflow_system_variables

    def _handle_workflow_run_start(
        self,
        *,
        session: Session,
        workflow_id: str,
        user_id: str,
        created_by_role: CreatedByRole,
    ) -> WorkflowRun:
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

        triggered_from = (
            WorkflowRunTriggeredFrom.DEBUGGING
            if self._application_generate_entity.invoke_from == InvokeFrom.DEBUGGER
            else WorkflowRunTriggeredFrom.APP_RUN
        )

        # handle special values
        inputs = dict(WorkflowEntry.handle_special_values(inputs) or {})

        # init workflow run
        # TODO: This workflow_run_id should always not be None, maybe we can use a more elegant way to handle this
        workflow_run_id = str(self._workflow_system_variables.get(SystemVariableKey.WORKFLOW_RUN_ID) or uuid4())

        workflow_run = WorkflowRun()
        workflow_run.id = workflow_run_id
        workflow_run.tenant_id = workflow.tenant_id
        workflow_run.app_id = workflow.app_id
        workflow_run.sequence_number = new_sequence_number
        workflow_run.workflow_id = workflow.id
        workflow_run.type = workflow.type
        workflow_run.triggered_from = triggered_from.value
        workflow_run.version = workflow.version
        workflow_run.graph = workflow.graph
        workflow_run.inputs = json.dumps(inputs)
        workflow_run.status = WorkflowRunStatus.RUNNING
        workflow_run.created_by_role = created_by_role
        workflow_run.created_by = user_id
        workflow_run.created_at = datetime.now(UTC).replace(tzinfo=None)

        session.add(workflow_run)

        return workflow_run

    def _handle_workflow_run_success(
        self,
        *,
        session: Session,
        workflow_run_id: str,
        start_at: float,
        total_tokens: int,
        total_steps: int,
        outputs: Mapping[str, Any] | None = None,
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> WorkflowRun:
        """
        Workflow run success
        :param workflow_run_id: workflow run id
        :param start_at: start time
        :param total_tokens: total tokens
        :param total_steps: total steps
        :param outputs: outputs
        :param conversation_id: conversation id
        :return:
        """
        workflow_run = self._get_workflow_run(session=session, workflow_run_id=workflow_run_id)

        outputs = WorkflowEntry.handle_special_values(outputs)

        workflow_run.status = WorkflowRunStatus.SUCCEEDED
        workflow_run.outputs = json.dumps(outputs or {})
        workflow_run.elapsed_time = time.perf_counter() - start_at
        workflow_run.total_tokens = total_tokens
        workflow_run.total_steps = total_steps
        workflow_run.finished_at = datetime.now(UTC).replace(tzinfo=None)

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_run=workflow_run,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

        return workflow_run

    def _handle_workflow_run_partial_success(
        self,
        *,
        session: Session,
        workflow_run_id: str,
        start_at: float,
        total_tokens: int,
        total_steps: int,
        outputs: Mapping[str, Any] | None = None,
        exceptions_count: int = 0,
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> WorkflowRun:
        workflow_run = self._get_workflow_run(session=session, workflow_run_id=workflow_run_id)
        outputs = WorkflowEntry.handle_special_values(dict(outputs) if outputs else None)

        workflow_run.status = WorkflowRunStatus.PARTIAL_SUCCEEDED.value
        workflow_run.outputs = json.dumps(outputs or {})
        workflow_run.elapsed_time = time.perf_counter() - start_at
        workflow_run.total_tokens = total_tokens
        workflow_run.total_steps = total_steps
        workflow_run.finished_at = datetime.now(UTC).replace(tzinfo=None)
        workflow_run.exceptions_count = exceptions_count

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_run=workflow_run,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

        return workflow_run

    def _handle_workflow_run_failed(
        self,
        *,
        session: Session,
        workflow_run_id: str,
        start_at: float,
        total_tokens: int,
        total_steps: int,
        status: WorkflowRunStatus,
        error: str,
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
        exceptions_count: int = 0,
    ) -> WorkflowRun:
        """
        Workflow run failed
        :param workflow_run_id: workflow run id
        :param start_at: start time
        :param total_tokens: total tokens
        :param total_steps: total steps
        :param status: status
        :param error: error message
        :return:
        """
        workflow_run = self._get_workflow_run(session=session, workflow_run_id=workflow_run_id)

        workflow_run.status = status.value
        workflow_run.error = error
        workflow_run.elapsed_time = time.perf_counter() - start_at
        workflow_run.total_tokens = total_tokens
        workflow_run.total_steps = total_steps
        workflow_run.finished_at = datetime.now(UTC).replace(tzinfo=None)
        workflow_run.exceptions_count = exceptions_count

        stmt = select(WorkflowNodeExecution.node_execution_id).where(
            WorkflowNodeExecution.tenant_id == workflow_run.tenant_id,
            WorkflowNodeExecution.app_id == workflow_run.app_id,
            WorkflowNodeExecution.workflow_id == workflow_run.workflow_id,
            WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            WorkflowNodeExecution.workflow_run_id == workflow_run.id,
            WorkflowNodeExecution.status == WorkflowNodeExecutionStatus.RUNNING.value,
        )
        ids = session.scalars(stmt).all()
        # Use self._get_workflow_node_execution here to make sure the cache is updated
        running_workflow_node_executions = [
            self._get_workflow_node_execution(session=session, node_execution_id=id) for id in ids if id
        ]

        for workflow_node_execution in running_workflow_node_executions:
            now = datetime.now(UTC).replace(tzinfo=None)
            workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
            workflow_node_execution.error = error
            workflow_node_execution.finished_at = now
            workflow_node_execution.elapsed_time = (now - workflow_node_execution.created_at).total_seconds()

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_run=workflow_run,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

        return workflow_run

    def _handle_node_execution_start(
        self, *, session: Session, workflow_run: WorkflowRun, event: QueueNodeStartedEvent
    ) -> WorkflowNodeExecution:
        workflow_node_execution = WorkflowNodeExecution()
        workflow_node_execution.id = str(uuid4())
        workflow_node_execution.tenant_id = workflow_run.tenant_id
        workflow_node_execution.app_id = workflow_run.app_id
        workflow_node_execution.workflow_id = workflow_run.workflow_id
        workflow_node_execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value
        workflow_node_execution.workflow_run_id = workflow_run.id
        workflow_node_execution.predecessor_node_id = event.predecessor_node_id
        workflow_node_execution.index = event.node_run_index
        workflow_node_execution.node_execution_id = event.node_execution_id
        workflow_node_execution.node_id = event.node_id
        workflow_node_execution.node_type = event.node_type.value
        workflow_node_execution.title = event.node_data.title
        workflow_node_execution.status = WorkflowNodeExecutionStatus.RUNNING.value
        workflow_node_execution.created_by_role = workflow_run.created_by_role
        workflow_node_execution.created_by = workflow_run.created_by
        workflow_node_execution.execution_metadata = json.dumps(
            {
                NodeRunMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
                NodeRunMetadataKey.ITERATION_ID: event.in_iteration_id,
                NodeRunMetadataKey.LOOP_ID: event.in_loop_id,
            }
        )
        workflow_node_execution.created_at = datetime.now(UTC).replace(tzinfo=None)

        session.add(workflow_node_execution)

        self._workflow_node_executions[event.node_execution_id] = workflow_node_execution
        return workflow_node_execution

    def _handle_workflow_node_execution_success(
        self, *, session: Session, event: QueueNodeSucceededEvent
    ) -> WorkflowNodeExecution:
        workflow_node_execution = self._get_workflow_node_execution(
            session=session, node_execution_id=event.node_execution_id
        )
        inputs = WorkflowEntry.handle_special_values(event.inputs)
        process_data = WorkflowEntry.handle_special_values(event.process_data)
        outputs = WorkflowEntry.handle_special_values(event.outputs)
        execution_metadata_dict = dict(event.execution_metadata or {})
        execution_metadata = json.dumps(jsonable_encoder(execution_metadata_dict)) if execution_metadata_dict else None
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - event.start_at).total_seconds()

        process_data = WorkflowEntry.handle_special_values(event.process_data)

        workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.process_data = json.dumps(process_data) if process_data else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.execution_metadata = execution_metadata
        workflow_node_execution.finished_at = finished_at
        workflow_node_execution.elapsed_time = elapsed_time

        workflow_node_execution = session.merge(workflow_node_execution)
        return workflow_node_execution

    def _handle_workflow_node_execution_failed(
        self,
        *,
        session: Session,
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
        workflow_node_execution = self._get_workflow_node_execution(
            session=session, node_execution_id=event.node_execution_id
        )

        inputs = WorkflowEntry.handle_special_values(event.inputs)
        process_data = WorkflowEntry.handle_special_values(event.process_data)
        outputs = WorkflowEntry.handle_special_values(event.outputs)
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - event.start_at).total_seconds()
        execution_metadata = (
            json.dumps(jsonable_encoder(event.execution_metadata)) if event.execution_metadata else None
        )
        process_data = WorkflowEntry.handle_special_values(event.process_data)
        workflow_node_execution.status = (
            WorkflowNodeExecutionStatus.FAILED.value
            if not isinstance(event, QueueNodeExceptionEvent)
            else WorkflowNodeExecutionStatus.EXCEPTION.value
        )
        workflow_node_execution.error = event.error
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.process_data = json.dumps(process_data) if process_data else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.finished_at = finished_at
        workflow_node_execution.elapsed_time = elapsed_time
        workflow_node_execution.execution_metadata = execution_metadata

        workflow_node_execution = session.merge(workflow_node_execution)
        return workflow_node_execution

    def _handle_workflow_node_execution_retried(
        self, *, session: Session, workflow_run: WorkflowRun, event: QueueNodeRetryEvent
    ) -> WorkflowNodeExecution:
        """
        Workflow node execution failed
        :param event: queue node failed event
        :return:
        """
        created_at = event.start_at
        finished_at = datetime.now(UTC).replace(tzinfo=None)
        elapsed_time = (finished_at - created_at).total_seconds()
        inputs = WorkflowEntry.handle_special_values(event.inputs)
        outputs = WorkflowEntry.handle_special_values(event.outputs)
        origin_metadata = {
            NodeRunMetadataKey.ITERATION_ID: event.in_iteration_id,
            NodeRunMetadataKey.PARALLEL_MODE_RUN_ID: event.parallel_mode_run_id,
            NodeRunMetadataKey.LOOP_ID: event.in_loop_id,
        }
        merged_metadata = (
            {**jsonable_encoder(event.execution_metadata), **origin_metadata}
            if event.execution_metadata is not None
            else origin_metadata
        )
        execution_metadata = json.dumps(merged_metadata)

        workflow_node_execution = WorkflowNodeExecution()
        workflow_node_execution.id = str(uuid4())
        workflow_node_execution.tenant_id = workflow_run.tenant_id
        workflow_node_execution.app_id = workflow_run.app_id
        workflow_node_execution.workflow_id = workflow_run.workflow_id
        workflow_node_execution.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value
        workflow_node_execution.workflow_run_id = workflow_run.id
        workflow_node_execution.predecessor_node_id = event.predecessor_node_id
        workflow_node_execution.node_execution_id = event.node_execution_id
        workflow_node_execution.node_id = event.node_id
        workflow_node_execution.node_type = event.node_type.value
        workflow_node_execution.title = event.node_data.title
        workflow_node_execution.status = WorkflowNodeExecutionStatus.RETRY.value
        workflow_node_execution.created_by_role = workflow_run.created_by_role
        workflow_node_execution.created_by = workflow_run.created_by
        workflow_node_execution.created_at = created_at
        workflow_node_execution.finished_at = finished_at
        workflow_node_execution.elapsed_time = elapsed_time
        workflow_node_execution.error = event.error
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.execution_metadata = execution_metadata
        workflow_node_execution.index = event.node_run_index

        session.add(workflow_node_execution)

        self._workflow_node_executions[event.node_execution_id] = workflow_node_execution
        return workflow_node_execution

    #################################################
    #             to stream responses               #
    #################################################

    def _workflow_start_to_stream_response(
        self,
        *,
        session: Session,
        task_id: str,
        workflow_run: WorkflowRun,
    ) -> WorkflowStartStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return WorkflowStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
            data=WorkflowStartStreamResponse.Data(
                id=workflow_run.id,
                workflow_id=workflow_run.workflow_id,
                sequence_number=workflow_run.sequence_number,
                inputs=dict(workflow_run.inputs_dict or {}),
                created_at=int(workflow_run.created_at.timestamp()),
            ),
        )

    def _workflow_finish_to_stream_response(
        self,
        *,
        session: Session,
        task_id: str,
        workflow_run: WorkflowRun,
    ) -> WorkflowFinishStreamResponse:
        created_by = None
        if workflow_run.created_by_role == CreatedByRole.ACCOUNT:
            stmt = select(Account).where(Account.id == workflow_run.created_by)
            account = session.scalar(stmt)
            if account:
                created_by = {
                    "id": account.id,
                    "name": account.name,
                    "email": account.email,
                }
        elif workflow_run.created_by_role == CreatedByRole.END_USER:
            stmt = select(EndUser).where(EndUser.id == workflow_run.created_by)
            end_user = session.scalar(stmt)
            if end_user:
                created_by = {
                    "id": end_user.id,
                    "user": end_user.session_id,
                }
        else:
            raise NotImplementedError(f"unknown created_by_role: {workflow_run.created_by_role}")

        return WorkflowFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
            data=WorkflowFinishStreamResponse.Data(
                id=workflow_run.id,
                workflow_id=workflow_run.workflow_id,
                sequence_number=workflow_run.sequence_number,
                status=workflow_run.status,
                outputs=dict(workflow_run.outputs_dict) if workflow_run.outputs_dict else None,
                error=workflow_run.error,
                elapsed_time=workflow_run.elapsed_time,
                total_tokens=workflow_run.total_tokens,
                total_steps=workflow_run.total_steps,
                created_by=created_by,
                created_at=int(workflow_run.created_at.timestamp()),
                finished_at=int(workflow_run.finished_at.timestamp()),
                files=self._fetch_files_from_node_outputs(dict(workflow_run.outputs_dict)),
                exceptions_count=workflow_run.exceptions_count,
            ),
        )

    def _workflow_node_start_to_stream_response(
        self,
        *,
        session: Session,
        event: QueueNodeStartedEvent,
        task_id: str,
        workflow_node_execution: WorkflowNodeExecution,
    ) -> Optional[NodeStartStreamResponse]:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session

        if workflow_node_execution.node_type in {NodeType.ITERATION.value, NodeType.LOOP.value}:
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
                inputs=workflow_node_execution.inputs_dict,
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

    def _workflow_node_finish_to_stream_response(
        self,
        *,
        session: Session,
        event: QueueNodeSucceededEvent
        | QueueNodeFailedEvent
        | QueueNodeInIterationFailedEvent
        | QueueNodeInLoopFailedEvent
        | QueueNodeExceptionEvent,
        task_id: str,
        workflow_node_execution: WorkflowNodeExecution,
    ) -> Optional[NodeFinishStreamResponse]:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        if workflow_node_execution.node_type in {NodeType.ITERATION.value, NodeType.LOOP.value}:
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
                inputs=workflow_node_execution.inputs_dict,
                process_data=workflow_node_execution.process_data_dict,
                outputs=workflow_node_execution.outputs_dict,
                status=workflow_node_execution.status,
                error=workflow_node_execution.error,
                elapsed_time=workflow_node_execution.elapsed_time,
                execution_metadata=workflow_node_execution.execution_metadata_dict,
                created_at=int(workflow_node_execution.created_at.timestamp()),
                finished_at=int(workflow_node_execution.finished_at.timestamp()),
                files=self._fetch_files_from_node_outputs(workflow_node_execution.outputs_dict or {}),
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
            ),
        )

    def _workflow_node_retry_to_stream_response(
        self,
        *,
        session: Session,
        event: QueueNodeRetryEvent,
        task_id: str,
        workflow_node_execution: WorkflowNodeExecution,
    ) -> Optional[Union[NodeRetryStreamResponse, NodeFinishStreamResponse]]:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        if workflow_node_execution.node_type in {NodeType.ITERATION.value, NodeType.LOOP.value}:
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
                inputs=workflow_node_execution.inputs_dict,
                process_data=workflow_node_execution.process_data_dict,
                outputs=workflow_node_execution.outputs_dict,
                status=workflow_node_execution.status,
                error=workflow_node_execution.error,
                elapsed_time=workflow_node_execution.elapsed_time,
                execution_metadata=workflow_node_execution.execution_metadata_dict,
                created_at=int(workflow_node_execution.created_at.timestamp()),
                finished_at=int(workflow_node_execution.finished_at.timestamp()),
                files=self._fetch_files_from_node_outputs(workflow_node_execution.outputs_dict or {}),
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                loop_id=event.in_loop_id,
                retry_index=event.retry_index,
            ),
        )

    def _workflow_parallel_branch_start_to_stream_response(
        self, *, session: Session, task_id: str, workflow_run: WorkflowRun, event: QueueParallelBranchRunStartedEvent
    ) -> ParallelBranchStartStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return ParallelBranchStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _workflow_parallel_branch_finished_to_stream_response(
        self,
        *,
        session: Session,
        task_id: str,
        workflow_run: WorkflowRun,
        event: QueueParallelBranchRunSucceededEvent | QueueParallelBranchRunFailedEvent,
    ) -> ParallelBranchFinishedStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return ParallelBranchFinishedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _workflow_iteration_start_to_stream_response(
        self, *, session: Session, task_id: str, workflow_run: WorkflowRun, event: QueueIterationStartEvent
    ) -> IterationNodeStartStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return IterationNodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _workflow_iteration_next_to_stream_response(
        self, *, session: Session, task_id: str, workflow_run: WorkflowRun, event: QueueIterationNextEvent
    ) -> IterationNodeNextStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return IterationNodeNextStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _workflow_iteration_completed_to_stream_response(
        self, *, session: Session, task_id: str, workflow_run: WorkflowRun, event: QueueIterationCompletedEvent
    ) -> IterationNodeCompletedStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return IterationNodeCompletedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _workflow_loop_start_to_stream_response(
        self, *, session: Session, task_id: str, workflow_run: WorkflowRun, event: QueueLoopStartEvent
    ) -> LoopNodeStartStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return LoopNodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _workflow_loop_next_to_stream_response(
        self, *, session: Session, task_id: str, workflow_run: WorkflowRun, event: QueueLoopNextEvent
    ) -> LoopNodeNextStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return LoopNodeNextStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _workflow_loop_completed_to_stream_response(
        self, *, session: Session, task_id: str, workflow_run: WorkflowRun, event: QueueLoopCompletedEvent
    ) -> LoopNodeCompletedStreamResponse:
        # receive session to make sure the workflow_run won't be expired, need a more elegant way to handle this
        _ = session
        return LoopNodeCompletedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
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

    def _fetch_files_from_node_outputs(self, outputs_dict: Mapping[str, Any]) -> Sequence[Mapping[str, Any]]:
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

    def _get_workflow_run(self, *, session: Session, workflow_run_id: str) -> WorkflowRun:
        if self._workflow_run and self._workflow_run.id == workflow_run_id:
            cached_workflow_run = self._workflow_run
            cached_workflow_run = session.merge(cached_workflow_run)
            return cached_workflow_run
        stmt = select(WorkflowRun).where(WorkflowRun.id == workflow_run_id)
        workflow_run = session.scalar(stmt)
        if not workflow_run:
            raise WorkflowRunNotFoundError(workflow_run_id)
        self._workflow_run = workflow_run

        return workflow_run

    def _get_workflow_node_execution(self, session: Session, node_execution_id: str) -> WorkflowNodeExecution:
        if node_execution_id not in self._workflow_node_executions:
            raise ValueError(f"Workflow node execution not found: {node_execution_id}")
        cached_workflow_node_execution = self._workflow_node_executions[node_execution_id]
        return session.merge(cached_workflow_node_execution)

    def _handle_agent_log(self, task_id: str, event: QueueAgentLogEvent) -> AgentLogStreamResponse:
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
