import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Optional, Union, cast

from sqlalchemy import select
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
from core.file import FILE_MODEL_IDENTITY, File
from core.tools.tool_manager import ToolManager
from core.variables.segments import ArrayFileSegment, FileSegment, Segment
from core.workflow.entities.workflow_execution import WorkflowExecution
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution, WorkflowNodeExecutionStatus
from core.workflow.nodes import NodeType
from core.workflow.nodes.tool.entities import ToolNodeData
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowRun,
)


class WorkflowResponseConverter:
    def __init__(
        self,
        *,
        application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity],
    ) -> None:
        self._application_generate_entity = application_generate_entity

    def workflow_start_to_stream_response(
        self,
        *,
        task_id: str,
        workflow_execution: WorkflowExecution,
    ) -> WorkflowStartStreamResponse:
        return WorkflowStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution.id_,
            data=WorkflowStartStreamResponse.Data(
                id=workflow_execution.id_,
                workflow_id=workflow_execution.workflow_id,
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
        workflow_run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == workflow_execution.id_))
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
            workflow_run_id=workflow_execution.id_,
            data=WorkflowFinishStreamResponse.Data(
                id=workflow_execution.id_,
                workflow_id=workflow_execution.workflow_id,
                status=workflow_execution.status,
                outputs=WorkflowRuntimeTypeConverter().to_json_encodable(workflow_execution.outputs),
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
        workflow_node_execution: WorkflowNodeExecution,
    ) -> Optional[NodeStartStreamResponse]:
        if workflow_node_execution.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        if not workflow_node_execution.workflow_execution_id:
            return None

        response = NodeStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_node_execution.workflow_execution_id,
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
        workflow_node_execution: WorkflowNodeExecution,
    ) -> Optional[NodeFinishStreamResponse]:
        if workflow_node_execution.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        if not workflow_node_execution.workflow_execution_id:
            return None
        if not workflow_node_execution.finished_at:
            return None

        json_converter = WorkflowRuntimeTypeConverter()

        return NodeFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_node_execution.workflow_execution_id,
            data=NodeFinishStreamResponse.Data(
                id=workflow_node_execution.id,
                node_id=workflow_node_execution.node_id,
                node_type=workflow_node_execution.node_type,
                index=workflow_node_execution.index,
                title=workflow_node_execution.title,
                predecessor_node_id=workflow_node_execution.predecessor_node_id,
                inputs=workflow_node_execution.inputs,
                process_data=workflow_node_execution.process_data,
                outputs=json_converter.to_json_encodable(workflow_node_execution.outputs),
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
        workflow_node_execution: WorkflowNodeExecution,
    ) -> Optional[Union[NodeRetryStreamResponse, NodeFinishStreamResponse]]:
        if workflow_node_execution.node_type in {NodeType.ITERATION, NodeType.LOOP}:
            return None
        if not workflow_node_execution.workflow_execution_id:
            return None
        if not workflow_node_execution.finished_at:
            return None

        json_converter = WorkflowRuntimeTypeConverter()

        return NodeRetryStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_node_execution.workflow_execution_id,
            data=NodeRetryStreamResponse.Data(
                id=workflow_node_execution.id,
                node_id=workflow_node_execution.node_id,
                node_type=workflow_node_execution.node_type,
                index=workflow_node_execution.index,
                title=workflow_node_execution.title,
                predecessor_node_id=workflow_node_execution.predecessor_node_id,
                inputs=workflow_node_execution.inputs,
                process_data=workflow_node_execution.process_data,
                outputs=json_converter.to_json_encodable(workflow_node_execution.outputs),
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
        json_converter = WorkflowRuntimeTypeConverter()
        return IterationNodeCompletedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_execution_id,
            data=IterationNodeCompletedStreamResponse.Data(
                id=event.node_id,
                node_id=event.node_id,
                node_type=event.node_type.value,
                title=event.node_data.title,
                outputs=json_converter.to_json_encodable(event.outputs),
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
                outputs=WorkflowRuntimeTypeConverter().to_json_encodable(event.outputs),
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

    @classmethod
    def _fetch_files_from_variable_value(cls, value: Union[dict, list, Segment]) -> Sequence[Mapping[str, Any]]:
        """
        Fetch files from variable value
        :param value: variable value
        :return:
        """
        if not value:
            return []

        files: list[Mapping[str, Any]] = []
        if isinstance(value, FileSegment):
            files.append(value.value.to_dict())
        elif isinstance(value, ArrayFileSegment):
            files.extend([i.to_dict() for i in value.value])
        elif isinstance(value, File):
            files.append(value.to_dict())
        elif isinstance(value, list):
            for item in value:
                file = cls._get_file_var_from_value(item)
                if file:
                    files.append(file)
        elif isinstance(
            value,
            dict,
        ):
            file = cls._get_file_var_from_value(value)
            if file:
                files.append(file)

        return files

    @classmethod
    def _get_file_var_from_value(cls, value: Union[dict, list]) -> Mapping[str, Any] | None:
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
