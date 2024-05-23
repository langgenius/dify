import json
import time
from datetime import datetime, timezone
from typing import Optional, Union, cast

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    QueueNodeFailedEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueStopEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowSucceededEvent,
)
from core.app.entities.task_entities import (
    NodeExecutionInfo,
    NodeFinishStreamResponse,
    NodeStartStreamResponse,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
)
from core.app.task_pipeline.workflow_iteration_cycle_manage import WorkflowIterationCycleManage
from core.file.file_obj import FileVar
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.tool_manager import ToolManager
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeType
from core.workflow.nodes.tool.entities import ToolNodeData
from core.workflow.workflow_engine_manager import WorkflowEngineManager
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


class WorkflowCycleManage(WorkflowIterationCycleManage):
    def _init_workflow_run(self, workflow: Workflow,
                           triggered_from: WorkflowRunTriggeredFrom,
                           user: Union[Account, EndUser],
                           user_inputs: dict,
                           system_inputs: Optional[dict] = None) -> WorkflowRun:
        """
        Init workflow run
        :param workflow: Workflow instance
        :param triggered_from: triggered from
        :param user: account or end user
        :param user_inputs: user variables inputs
        :param system_inputs: system inputs, like: query, files
        :return:
        """
        max_sequence = db.session.query(db.func.max(WorkflowRun.sequence_number)) \
                           .filter(WorkflowRun.tenant_id == workflow.tenant_id) \
                           .filter(WorkflowRun.app_id == workflow.app_id) \
                           .scalar() or 0
        new_sequence_number = max_sequence + 1

        inputs = {**user_inputs}
        for key, value in (system_inputs or {}).items():
            if key.value == 'conversation':
                continue

            inputs[f'sys.{key.value}'] = value
        inputs = WorkflowEngineManager.handle_special_values(inputs)

        # init workflow run
        workflow_run = WorkflowRun(
            tenant_id=workflow.tenant_id,
            app_id=workflow.app_id,
            sequence_number=new_sequence_number,
            workflow_id=workflow.id,
            type=workflow.type,
            triggered_from=triggered_from.value,
            version=workflow.version,
            graph=workflow.graph,
            inputs=json.dumps(inputs),
            status=WorkflowRunStatus.RUNNING.value,
            created_by_role=(CreatedByRole.ACCOUNT.value
                             if isinstance(user, Account) else CreatedByRole.END_USER.value),
            created_by=user.id
        )

        db.session.add(workflow_run)
        db.session.commit()
        db.session.refresh(workflow_run)
        db.session.close()

        return workflow_run

    def _workflow_run_success(self, workflow_run: WorkflowRun,
                              start_at: float,
                              total_tokens: int,
                              total_steps: int,
                              outputs: Optional[str] = None) -> WorkflowRun:
        """
        Workflow run success
        :param workflow_run: workflow run
        :param start_at: start time
        :param total_tokens: total tokens
        :param total_steps: total steps
        :param outputs: outputs
        :return:
        """
        workflow_run.status = WorkflowRunStatus.SUCCEEDED.value
        workflow_run.outputs = outputs
        workflow_run.elapsed_time = time.perf_counter() - start_at
        workflow_run.total_tokens = total_tokens
        workflow_run.total_steps = total_steps
        workflow_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

        db.session.commit()
        db.session.refresh(workflow_run)
        db.session.close()

        return workflow_run

    def _workflow_run_failed(self, workflow_run: WorkflowRun,
                             start_at: float,
                             total_tokens: int,
                             total_steps: int,
                             status: WorkflowRunStatus,
                             error: str) -> WorkflowRun:
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
        workflow_run.status = status.value
        workflow_run.error = error
        workflow_run.elapsed_time = time.perf_counter() - start_at
        workflow_run.total_tokens = total_tokens
        workflow_run.total_steps = total_steps
        workflow_run.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

        db.session.commit()
        db.session.refresh(workflow_run)
        db.session.close()

        return workflow_run

    def _init_node_execution_from_workflow_run(self, workflow_run: WorkflowRun,
                                               node_id: str,
                                               node_type: NodeType,
                                               node_title: str,
                                               node_run_index: int = 1,
                                               predecessor_node_id: Optional[str] = None) -> WorkflowNodeExecution:
        """
        Init workflow node execution from workflow run
        :param workflow_run: workflow run
        :param node_id: node id
        :param node_type: node type
        :param node_title: node title
        :param node_run_index: run index
        :param predecessor_node_id: predecessor node id if exists
        :return:
        """
        # init workflow node execution
        workflow_node_execution = WorkflowNodeExecution(
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
            workflow_id=workflow_run.workflow_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            workflow_run_id=workflow_run.id,
            predecessor_node_id=predecessor_node_id,
            index=node_run_index,
            node_id=node_id,
            node_type=node_type.value,
            title=node_title,
            status=WorkflowNodeExecutionStatus.RUNNING.value,
            created_by_role=workflow_run.created_by_role,
            created_by=workflow_run.created_by
        )

        db.session.add(workflow_node_execution)
        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution

    def _workflow_node_execution_success(self, workflow_node_execution: WorkflowNodeExecution,
                                         start_at: float,
                                         inputs: Optional[dict] = None,
                                         process_data: Optional[dict] = None,
                                         outputs: Optional[dict] = None,
                                         execution_metadata: Optional[dict] = None) -> WorkflowNodeExecution:
        """
        Workflow node execution success
        :param workflow_node_execution: workflow node execution
        :param start_at: start time
        :param inputs: inputs
        :param process_data: process data
        :param outputs: outputs
        :param execution_metadata: execution metadata
        :return:
        """
        inputs = WorkflowEngineManager.handle_special_values(inputs)
        outputs = WorkflowEngineManager.handle_special_values(outputs)

        workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.process_data = json.dumps(process_data) if process_data else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.execution_metadata = json.dumps(jsonable_encoder(execution_metadata)) \
            if execution_metadata else None
        workflow_node_execution.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)

        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution

    def _workflow_node_execution_failed(self, workflow_node_execution: WorkflowNodeExecution,
                                        start_at: float,
                                        error: str,
                                        inputs: Optional[dict] = None,
                                        process_data: Optional[dict] = None,
                                        outputs: Optional[dict] = None,
                                        execution_metadata: Optional[dict] = None
                                        ) -> WorkflowNodeExecution:
        """
        Workflow node execution failed
        :param workflow_node_execution: workflow node execution
        :param start_at: start time
        :param error: error message
        :return:
        """
        inputs = WorkflowEngineManager.handle_special_values(inputs)
        outputs = WorkflowEngineManager.handle_special_values(outputs)

        workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
        workflow_node_execution.error = error
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.process_data = json.dumps(process_data) if process_data else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.execution_metadata = json.dumps(jsonable_encoder(execution_metadata)) \
            if execution_metadata else None

        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution

    def _workflow_start_to_stream_response(self, task_id: str,
                                           workflow_run: WorkflowRun) -> WorkflowStartStreamResponse:
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
                inputs=workflow_run.inputs_dict,
                created_at=int(workflow_run.created_at.timestamp())
            )
        )

    def _workflow_finish_to_stream_response(self, task_id: str,
                                            workflow_run: WorkflowRun) -> WorkflowFinishStreamResponse:
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
                files=self._fetch_files_from_node_outputs(workflow_run.outputs_dict)
            )
        )

    def _workflow_node_start_to_stream_response(self, event: QueueNodeStartedEvent,
                                                task_id: str,
                                                workflow_node_execution: WorkflowNodeExecution) \
            -> NodeStartStreamResponse:
        """
        Workflow node start to stream response.
        :param event: queue node started event
        :param task_id: task id
        :param workflow_node_execution: workflow node execution
        :return:
        """
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
                created_at=int(workflow_node_execution.created_at.timestamp())
            )
        )

        # extras logic
        if event.node_type == NodeType.TOOL:
            node_data = cast(ToolNodeData, event.node_data)
            response.data.extras['icon'] = ToolManager.get_tool_icon(
                tenant_id=self._application_generate_entity.app_config.tenant_id,
                provider_type=node_data.provider_type,
                provider_id=node_data.provider_id
            )

        return response

    def _workflow_node_finish_to_stream_response(self, task_id: str, workflow_node_execution: WorkflowNodeExecution) \
            -> NodeFinishStreamResponse:
        """
        Workflow node finish to stream response.
        :param task_id: task id
        :param workflow_node_execution: workflow node execution
        :return:
        """
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
                files=self._fetch_files_from_node_outputs(workflow_node_execution.outputs_dict)
            )
        )

    def _handle_workflow_start(self) -> WorkflowRun:
        self._task_state.start_at = time.perf_counter()

        workflow_run = self._init_workflow_run(
            workflow=self._workflow,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING
            if self._application_generate_entity.invoke_from == InvokeFrom.DEBUGGER
            else WorkflowRunTriggeredFrom.APP_RUN,
            user=self._user,
            user_inputs=self._application_generate_entity.inputs,
            system_inputs=self._workflow_system_variables
        )

        self._task_state.workflow_run_id = workflow_run.id

        db.session.close()

        return workflow_run

    def _handle_node_start(self, event: QueueNodeStartedEvent) -> WorkflowNodeExecution:
        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == self._task_state.workflow_run_id).first()
        workflow_node_execution = self._init_node_execution_from_workflow_run(
            workflow_run=workflow_run,
            node_id=event.node_id,
            node_type=event.node_type,
            node_title=event.node_data.title,
            node_run_index=event.node_run_index,
            predecessor_node_id=event.predecessor_node_id
        )

        latest_node_execution_info = NodeExecutionInfo(
            workflow_node_execution_id=workflow_node_execution.id,
            node_type=event.node_type,
            start_at=time.perf_counter()
        )

        self._task_state.ran_node_execution_infos[event.node_id] = latest_node_execution_info
        self._task_state.latest_node_execution_info = latest_node_execution_info

        self._task_state.total_steps += 1

        db.session.close()

        return workflow_node_execution

    def _handle_node_finished(self, event: QueueNodeSucceededEvent | QueueNodeFailedEvent) -> WorkflowNodeExecution:
        current_node_execution = self._task_state.ran_node_execution_infos[event.node_id]
        workflow_node_execution = db.session.query(WorkflowNodeExecution).filter(
            WorkflowNodeExecution.id == current_node_execution.workflow_node_execution_id).first()
        
        execution_metadata = event.execution_metadata if isinstance(event, QueueNodeSucceededEvent) else None
        
        if self._iteration_state and self._iteration_state.current_iterations:
            if not execution_metadata:
                execution_metadata = {}
            current_iteration_data = None
            for iteration_node_id in self._iteration_state.current_iterations:
                data = self._iteration_state.current_iterations[iteration_node_id]
                if data.parent_iteration_id == None:
                    current_iteration_data = data
                    break

            if current_iteration_data:
                execution_metadata[NodeRunMetadataKey.ITERATION_ID] = current_iteration_data.iteration_id
                execution_metadata[NodeRunMetadataKey.ITERATION_INDEX] = current_iteration_data.current_index

        if isinstance(event, QueueNodeSucceededEvent):
            workflow_node_execution = self._workflow_node_execution_success(
                workflow_node_execution=workflow_node_execution,
                start_at=current_node_execution.start_at,
                inputs=event.inputs,
                process_data=event.process_data,
                outputs=event.outputs,
                execution_metadata=execution_metadata
            )

            if execution_metadata and execution_metadata.get(NodeRunMetadataKey.TOTAL_TOKENS):
                self._task_state.total_tokens += (
                    int(execution_metadata.get(NodeRunMetadataKey.TOTAL_TOKENS)))
                
                if self._iteration_state:
                    for iteration_node_id in self._iteration_state.current_iterations:
                        data = self._iteration_state.current_iterations[iteration_node_id]
                        if execution_metadata.get(NodeRunMetadataKey.TOTAL_TOKENS):
                            data.total_tokens += int(execution_metadata.get(NodeRunMetadataKey.TOTAL_TOKENS))

            if workflow_node_execution.node_type == NodeType.LLM.value:
                outputs = workflow_node_execution.outputs_dict
                usage_dict = outputs.get('usage', {})
                self._task_state.metadata['usage'] = usage_dict
        else:
            workflow_node_execution = self._workflow_node_execution_failed(
                workflow_node_execution=workflow_node_execution,
                start_at=current_node_execution.start_at,
                error=event.error,
                inputs=event.inputs,
                process_data=event.process_data,
                outputs=event.outputs,
                execution_metadata=execution_metadata
            )

        db.session.close()

        return workflow_node_execution

    def _handle_workflow_finished(self, event: QueueStopEvent | QueueWorkflowSucceededEvent | QueueWorkflowFailedEvent) \
            -> Optional[WorkflowRun]:
        workflow_run = db.session.query(WorkflowRun).filter(
            WorkflowRun.id == self._task_state.workflow_run_id).first()
        if not workflow_run:
            return None

        if isinstance(event, QueueStopEvent):
            workflow_run = self._workflow_run_failed(
                workflow_run=workflow_run,
                start_at=self._task_state.start_at,
                total_tokens=self._task_state.total_tokens,
                total_steps=self._task_state.total_steps,
                status=WorkflowRunStatus.STOPPED,
                error='Workflow stopped.'
            )

            latest_node_execution_info = self._task_state.latest_node_execution_info
            if latest_node_execution_info:
                workflow_node_execution = db.session.query(WorkflowNodeExecution).filter(
                    WorkflowNodeExecution.id == latest_node_execution_info.workflow_node_execution_id).first()
                if (workflow_node_execution
                        and workflow_node_execution.status == WorkflowNodeExecutionStatus.RUNNING.value):
                    self._workflow_node_execution_failed(
                        workflow_node_execution=workflow_node_execution,
                        start_at=latest_node_execution_info.start_at,
                        error='Workflow stopped.'
                    )
        elif isinstance(event, QueueWorkflowFailedEvent):
            workflow_run = self._workflow_run_failed(
                workflow_run=workflow_run,
                start_at=self._task_state.start_at,
                total_tokens=self._task_state.total_tokens,
                total_steps=self._task_state.total_steps,
                status=WorkflowRunStatus.FAILED,
                error=event.error
            )
        else:
            if self._task_state.latest_node_execution_info:
                workflow_node_execution = db.session.query(WorkflowNodeExecution).filter(
                    WorkflowNodeExecution.id == self._task_state.latest_node_execution_info.workflow_node_execution_id).first()
                outputs = workflow_node_execution.outputs
            else:
                outputs = None

            workflow_run = self._workflow_run_success(
                workflow_run=workflow_run,
                start_at=self._task_state.start_at,
                total_tokens=self._task_state.total_tokens,
                total_steps=self._task_state.total_steps,
                outputs=outputs
            )

        self._task_state.workflow_run_id = workflow_run.id

        db.session.close()

        return workflow_run

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
            if '__variant' in value and value['__variant'] == FileVar.__name__:
                return value
        elif isinstance(value, FileVar):
            return value.to_dict()

        return None
