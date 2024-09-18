import json
import time
from datetime import datetime, timezone
from typing import Any, Optional, Union, cast

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueParallelBranchRunFailedEvent,
    QueueParallelBranchRunStartedEvent,
    QueueParallelBranchRunSucceededEvent,
)
from core.app.entities.task_entities import (
    IterationNodeCompletedStreamResponse,
    IterationNodeNextStreamResponse,
    IterationNodeStartStreamResponse,
    NodeFinishStreamResponse,
    NodeStartStreamResponse,
    ParallelBranchFinishedStreamResponse,
    ParallelBranchStartStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
    WorkflowTaskState,
)
from core.file.file_obj import FileVar
from core.model_runtime.utils.encoders import jsonable_encoder
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.tools.tool_manager import ToolManager
from core.workflow.entities.node_entities import NodeType
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.tool.entities import ToolNodeData
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_database import db
from models.account import Account
from models.model import EndUser
from models.workflow import (
    CreatedByRole,
    Workflow,
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunStatus,
    WorkflowRunTriggeredFrom,
)


class WorkflowCycleManage:
    _application_generate_entity: Union[AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity]
    _workflow: Workflow
    _user: Union[Account, EndUser]
    _task_state: WorkflowTaskState
    _workflow_system_variables: dict[SystemVariableKey, Any]

    def _handle_workflow_run_start(self) -> WorkflowRun:
        max_sequence = (
            db.session.query(db.func.max(WorkflowRun.sequence_number))
            .filter(WorkflowRun.tenant_id == self._workflow.tenant_id)
            .filter(WorkflowRun.app_id == self._workflow.app_id)
            .scalar()
            or 0
        )
        new_sequence_number = max_sequence + 1

        inputs = {**self._application_generate_entity.inputs}
        for key, value in (self._workflow_system_variables or {}).items():
            if key.value == "conversation":
                continue

            inputs[f"sys.{key.value}"] = value

        inputs = WorkflowEntry.handle_special_values(inputs)

        triggered_from = (
            WorkflowRunTriggeredFrom.DEBUGGING
            if self._application_generate_entity.invoke_from == InvokeFrom.DEBUGGER
            else WorkflowRunTriggeredFrom.APP_RUN
        )

        # init workflow run
        workflow_run = WorkflowRun()
        workflow_run.tenant_id = self._workflow.tenant_id
        workflow_run.app_id = self._workflow.app_id
        workflow_run.sequence_number = new_sequence_number
        workflow_run.workflow_id = self._workflow.id
        workflow_run.type = self._workflow.type
        workflow_run.triggered_from = triggered_from.value
        workflow_run.version = self._workflow.version
        workflow_run.graph = self._workflow.graph
        workflow_run.inputs = json.dumps(inputs)
        workflow_run.status = WorkflowRunStatus.RUNNING.value
        workflow_run.created_by_role = (
            CreatedByRole.ACCOUNT.value if isinstance(self._user, Account) else CreatedByRole.END_USER.value
        )
        workflow_run.created_by = self._user.id

        db.session.add(workflow_run)
        db.session.commit()
        db.session.refresh(workflow_run)
        db.session.close()

        return workflow_run

    def _handle_workflow_run_success(
        self,
        workflow_run: WorkflowRun,
        start_at: float,
        total_tokens: int,
        total_steps: int,
        outputs: Optional[str] = None,
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> WorkflowRun:
        """
        Workflow run success
        :param workflow_run: workflow run
        :param start_at: start time
        :param total_tokens: total tokens
        :param total_steps: total steps
        :param outputs: outputs
        :param conversation_id: conversation id
        :return:
        """
        workflow_run = self._refetch_workflow_run(workflow_run.id)

        workflow_run.status = WorkflowRunStatus.SUCCEEDED.value
        workflow_run.outputs = outputs
        workflow_run.elapsed_time = time.perf_counter() - start_at
        workflow_run.total_tokens = total_tokens
        workflow_run.total_steps = total_steps
        workflow_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

        db.session.commit()
        db.session.refresh(workflow_run)

        if trace_manager:
            trace_manager.add_trace_task(
                TraceTask(
                    TraceTaskName.WORKFLOW_TRACE,
                    workflow_run=workflow_run,
                    conversation_id=conversation_id,
                    user_id=trace_manager.user_id,
                )
            )

        db.session.close()

        return workflow_run

    def _handle_workflow_run_failed(
        self,
        workflow_run: WorkflowRun,
        start_at: float,
        total_tokens: int,
        total_steps: int,
        status: WorkflowRunStatus,
        error: str,
        conversation_id: Optional[str] = None,
        trace_manager: Optional[TraceQueueManager] = None,
    ) -> WorkflowRun:
        """
        Workflow run failed
        :param workflow_run: workflow run
        :param start_at: start time
        :param total_tokens: total tokens
        :param total_steps: total steps
        :param status: status
        :param error: error message
        :return:
        """
        workflow_run = self._refetch_workflow_run(workflow_run.id)

        workflow_run.status = status.value
        workflow_run.error = error
        workflow_run.elapsed_time = time.perf_counter() - start_at
        workflow_run.total_tokens = total_tokens
        workflow_run.total_steps = total_steps
        workflow_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

        db.session.commit()

        running_workflow_node_executions = (
            db.session.query(WorkflowNodeExecution)
            .filter(
                WorkflowNodeExecution.tenant_id == workflow_run.tenant_id,
                WorkflowNodeExecution.app_id == workflow_run.app_id,
                WorkflowNodeExecution.workflow_id == workflow_run.workflow_id,
                WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
                WorkflowNodeExecution.workflow_run_id == workflow_run.id,
                WorkflowNodeExecution.status == WorkflowNodeExecutionStatus.RUNNING.value,
            )
            .all()
        )

        for workflow_node_execution in running_workflow_node_executions:
            workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
            workflow_node_execution.error = error
            workflow_node_execution.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
            workflow_node_execution.elapsed_time = (
                workflow_node_execution.finished_at - workflow_node_execution.created_at
            ).total_seconds()
            db.session.commit()

        db.session.refresh(workflow_run)
        db.session.close()

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
        self, workflow_run: WorkflowRun, event: QueueNodeStartedEvent
    ) -> WorkflowNodeExecution:
        # init workflow node execution
        workflow_node_execution = WorkflowNodeExecution()
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
        workflow_node_execution.created_at = datetime.now(timezone.utc).replace(tzinfo=None)

        db.session.add(workflow_node_execution)
        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution

    def _handle_workflow_node_execution_success(self, event: QueueNodeSucceededEvent) -> WorkflowNodeExecution:
        """
        Workflow node execution success
        :param event: queue node succeeded event
        :return:
        """
        workflow_node_execution = self._refetch_workflow_node_execution(event.node_execution_id)

        inputs = WorkflowEntry.handle_special_values(event.inputs)
        outputs = WorkflowEntry.handle_special_values(event.outputs)

        workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.process_data = json.dumps(event.process_data) if event.process_data else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.execution_metadata = (
            json.dumps(jsonable_encoder(event.execution_metadata)) if event.execution_metadata else None
        )
        workflow_node_execution.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        workflow_node_execution.elapsed_time = (workflow_node_execution.finished_at - event.start_at).total_seconds()

        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution

    def _handle_workflow_node_execution_failed(self, event: QueueNodeFailedEvent) -> WorkflowNodeExecution:
        """
        Workflow node execution failed
        :param event: queue node failed event
        :return:
        """
        workflow_node_execution = self._refetch_workflow_node_execution(event.node_execution_id)

        inputs = WorkflowEntry.handle_special_values(event.inputs)
        outputs = WorkflowEntry.handle_special_values(event.outputs)

        workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
        workflow_node_execution.error = event.error
        workflow_node_execution.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.process_data = json.dumps(event.process_data) if event.process_data else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.elapsed_time = (workflow_node_execution.finished_at - event.start_at).total_seconds()

        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution

    #################################################
    #             to stream responses               #
    #################################################

    def _workflow_start_to_stream_response(
        self, task_id: str, workflow_run: WorkflowRun
    ) -> WorkflowStartStreamResponse:
        """
        Workflow start to stream response.
        :param task_id: task id
        :param workflow_run: workflow run
        :return:
        """
        return WorkflowStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
            data=WorkflowStartStreamResponse.Data(
                id=workflow_run.id,
                workflow_id=workflow_run.workflow_id,
                sequence_number=workflow_run.sequence_number,
                inputs=workflow_run.inputs_dict or {},
                created_at=int(workflow_run.created_at.timestamp()),
            ),
        )

    def _workflow_finish_to_stream_response(
        self, task_id: str, workflow_run: WorkflowRun
    ) -> WorkflowFinishStreamResponse:
        """
        Workflow finish to stream response.
        :param task_id: task id
        :param workflow_run: workflow run
        :return:
        """
        created_by = None
        if workflow_run.created_by_role == CreatedByRole.ACCOUNT.value:
            created_by_account = workflow_run.created_by_account
            if created_by_account:
                created_by = {
                    "id": created_by_account.id,
                    "name": created_by_account.name,
                    "email": created_by_account.email,
                }
        else:
            created_by_end_user = workflow_run.created_by_end_user
            if created_by_end_user:
                created_by = {
                    "id": created_by_end_user.id,
                    "user": created_by_end_user.session_id,
                }

        return WorkflowFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
            data=WorkflowFinishStreamResponse.Data(
                id=workflow_run.id,
                workflow_id=workflow_run.workflow_id,
                sequence_number=workflow_run.sequence_number,
                status=workflow_run.status,
                outputs=workflow_run.outputs_dict,
                error=workflow_run.error,
                elapsed_time=workflow_run.elapsed_time,
                total_tokens=workflow_run.total_tokens,
                total_steps=workflow_run.total_steps,
                created_by=created_by,
                created_at=int(workflow_run.created_at.timestamp()),
                finished_at=int(workflow_run.finished_at.timestamp()),
                files=self._fetch_files_from_node_outputs(workflow_run.outputs_dict or {}),
            ),
        )

    def _workflow_node_start_to_stream_response(
        self, event: QueueNodeStartedEvent, task_id: str, workflow_node_execution: WorkflowNodeExecution
    ) -> Optional[NodeStartStreamResponse]:
        """
        Workflow node start to stream response.
        :param event: queue node started event
        :param task_id: task id
        :param workflow_node_execution: workflow node execution
        :return:
        """
        if workflow_node_execution.node_type in {NodeType.ITERATION.value, NodeType.LOOP.value}:
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
        event: QueueNodeSucceededEvent | QueueNodeFailedEvent,
        task_id: str,
        workflow_node_execution: WorkflowNodeExecution,
    ) -> Optional[NodeFinishStreamResponse]:
        """
        Workflow node finish to stream response.
        :param event: queue node succeeded or failed event
        :param task_id: task id
        :param workflow_node_execution: workflow node execution
        :return:
        """
        if workflow_node_execution.node_type in {NodeType.ITERATION.value, NodeType.LOOP.value}:
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
            ),
        )

    def _workflow_parallel_branch_start_to_stream_response(
        self, task_id: str, workflow_run: WorkflowRun, event: QueueParallelBranchRunStartedEvent
    ) -> ParallelBranchStartStreamResponse:
        """
        Workflow parallel branch start to stream response
        :param task_id: task id
        :param workflow_run: workflow run
        :param event: parallel branch run started event
        :return:
        """
        return ParallelBranchStartStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
            data=ParallelBranchStartStreamResponse.Data(
                parallel_id=event.parallel_id,
                parallel_branch_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                created_at=int(time.time()),
            ),
        )

    def _workflow_parallel_branch_finished_to_stream_response(
        self,
        task_id: str,
        workflow_run: WorkflowRun,
        event: QueueParallelBranchRunSucceededEvent | QueueParallelBranchRunFailedEvent,
    ) -> ParallelBranchFinishedStreamResponse:
        """
        Workflow parallel branch finished to stream response
        :param task_id: task id
        :param workflow_run: workflow run
        :param event: parallel branch run succeeded or failed event
        :return:
        """
        return ParallelBranchFinishedStreamResponse(
            task_id=task_id,
            workflow_run_id=workflow_run.id,
            data=ParallelBranchFinishedStreamResponse.Data(
                parallel_id=event.parallel_id,
                parallel_branch_id=event.parallel_start_node_id,
                parent_parallel_id=event.parent_parallel_id,
                parent_parallel_start_node_id=event.parent_parallel_start_node_id,
                iteration_id=event.in_iteration_id,
                status="succeeded" if isinstance(event, QueueParallelBranchRunSucceededEvent) else "failed",
                error=event.error if isinstance(event, QueueParallelBranchRunFailedEvent) else None,
                created_at=int(time.time()),
            ),
        )

    def _workflow_iteration_start_to_stream_response(
        self, task_id: str, workflow_run: WorkflowRun, event: QueueIterationStartEvent
    ) -> IterationNodeStartStreamResponse:
        """
        Workflow iteration start to stream response
        :param task_id: task id
        :param workflow_run: workflow run
        :param event: iteration start event
        :return:
        """
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
        self, task_id: str, workflow_run: WorkflowRun, event: QueueIterationNextEvent
    ) -> IterationNodeNextStreamResponse:
        """
        Workflow iteration next to stream response
        :param task_id: task id
        :param workflow_run: workflow run
        :param event: iteration next event
        :return:
        """
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
            ),
        )

    def _workflow_iteration_completed_to_stream_response(
        self, task_id: str, workflow_run: WorkflowRun, event: QueueIterationCompletedEvent
    ) -> IterationNodeCompletedStreamResponse:
        """
        Workflow iteration completed to stream response
        :param task_id: task id
        :param workflow_run: workflow run
        :param event: iteration completed event
        :return:
        """
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
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                error=None,
                elapsed_time=(datetime.now(timezone.utc).replace(tzinfo=None) - event.start_at).total_seconds(),
                total_tokens=event.metadata.get("total_tokens", 0) if event.metadata else 0,
                execution_metadata=event.metadata,
                finished_at=int(time.time()),
                steps=event.steps,
                parallel_id=event.parallel_id,
                parallel_start_node_id=event.parallel_start_node_id,
            ),
        )

    def _fetch_files_from_node_outputs(self, outputs_dict: dict) -> list[dict]:
        """
        Fetch files from node outputs
        :param outputs_dict: node outputs dict
        :return:
        """
        if not outputs_dict:
            return []

        files = []
        for output_var, output_value in outputs_dict.items():
            file_vars = self._fetch_files_from_variable_value(output_value)
            if file_vars:
                files.extend(file_vars)

        return files

    def _fetch_files_from_variable_value(self, value: Union[dict, list]) -> list[dict]:
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
                file_var = self._get_file_var_from_value(item)
                if file_var:
                    files.append(file_var)
        elif isinstance(value, dict):
            file_var = self._get_file_var_from_value(value)
            if file_var:
                files.append(file_var)

        return files

    def _get_file_var_from_value(self, value: Union[dict, list]) -> Optional[dict]:
        """
        Get file var from value
        :param value: variable value
        :return:
        """
        if not value:
            return None

        if isinstance(value, dict):
            if "__variant" in value and value["__variant"] == FileVar.__name__:
                return value
        elif isinstance(value, FileVar):
            return value.to_dict()

        return None

    def _refetch_workflow_run(self, workflow_run_id: str) -> WorkflowRun:
        """
        Refetch workflow run
        :param workflow_run_id: workflow run id
        :return:
        """
        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == workflow_run_id).first()

        if not workflow_run:
            raise Exception(f"Workflow run not found: {workflow_run_id}")

        return workflow_run

    def _refetch_workflow_node_execution(self, node_execution_id: str) -> WorkflowNodeExecution:
        """
        Refetch workflow node execution
        :param node_execution_id: workflow node execution id
        :return:
        """
        workflow_node_execution = (
            db.session.query(WorkflowNodeExecution)
            .filter(
                WorkflowNodeExecution.tenant_id == self._application_generate_entity.app_config.tenant_id,
                WorkflowNodeExecution.app_id == self._application_generate_entity.app_config.app_id,
                WorkflowNodeExecution.workflow_id == self._workflow.id,
                WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
                WorkflowNodeExecution.node_execution_id == node_execution_id,
            )
            .first()
        )

        if not workflow_node_execution:
            raise Exception(f"Workflow node execution not found: {node_execution_id}")

        return workflow_node_execution
