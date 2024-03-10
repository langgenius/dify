import json
import time
from datetime import datetime
from typing import Optional, Union

from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.entities.node_entities import NodeType
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


class WorkflowBasedGenerateTaskPipeline:
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
            inputs=json.dumps({**user_inputs, **jsonable_encoder(system_inputs)}),
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
                              outputs: Optional[dict] = None) -> WorkflowRun:
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
        workflow_run.finished_at = datetime.utcnow()

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
        workflow_run.finished_at = datetime.utcnow()

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
        workflow_node_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED.value
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.inputs = json.dumps(inputs) if inputs else None
        workflow_node_execution.process_data = json.dumps(process_data) if process_data else None
        workflow_node_execution.outputs = json.dumps(outputs) if outputs else None
        workflow_node_execution.execution_metadata = json.dumps(jsonable_encoder(execution_metadata)) \
            if execution_metadata else None
        workflow_node_execution.finished_at = datetime.utcnow()

        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution

    def _workflow_node_execution_failed(self, workflow_node_execution: WorkflowNodeExecution,
                                        start_at: float,
                                        error: str) -> WorkflowNodeExecution:
        """
        Workflow node execution failed
        :param workflow_node_execution: workflow node execution
        :param start_at: start time
        :param error: error message
        :return:
        """
        workflow_node_execution.status = WorkflowNodeExecutionStatus.FAILED.value
        workflow_node_execution.error = error
        workflow_node_execution.elapsed_time = time.perf_counter() - start_at
        workflow_node_execution.finished_at = datetime.utcnow()

        db.session.commit()
        db.session.refresh(workflow_node_execution)
        db.session.close()

        return workflow_node_execution
