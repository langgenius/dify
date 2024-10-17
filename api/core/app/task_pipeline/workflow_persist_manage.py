import json
import logging
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from flask import Flask, current_app
from pydantic import BaseModel

from configs import dify_config
from extensions.ext_database import db
from models.workflow import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowRunStatus,
)


class WorkflowPersistEvent(BaseModel):
    """
    WorkflowPersistEvent abstract entity
    """

    pass


class WorkflowRunStartEvent(WorkflowPersistEvent):
    """
    Workflow run start
    """

    workflow_run: dict


class WorkflowRunSuccessEvent(WorkflowPersistEvent):
    """
    Workflow run success
    """

    workflow_run_id: str
    elapsed_time: float
    total_tokens: int
    total_steps: int
    outputs: Optional[str]
    finished_at: datetime


class WorkflowRunFailedEvent(WorkflowPersistEvent):
    """
    Workflow run failed
    """

    workflow_run_id: str
    elapsed_time: float
    total_tokens: int
    total_steps: int
    status: WorkflowRunStatus
    error: str
    finished_at: datetime


class NodeExecutionStartEvent(WorkflowPersistEvent):
    """
    Workflow node execution start
    """

    workflow_node_execution: dict


class NodeExecutionSuccessEvent(WorkflowPersistEvent):
    """
    Workflow node execution success
    """

    node_execution_id: str
    inputs: Optional[dict]
    outputs: Optional[dict]
    execution_metadata: Optional[str]
    process_data: Optional[dict[str, Any]] = None
    finished_at: datetime
    elapsed_time: float


class NodeExecutionFailedEvent(WorkflowPersistEvent):
    """
    Workflow node execution failed
    """

    node_execution_id: str
    inputs: Optional[dict]
    outputs: Optional[dict]
    finished_at: datetime = datetime.now(timezone.utc).replace(tzinfo=None)
    elapsed_time: float
    error: str
    process_data: Optional[dict[str, Any]] = None


class WorkflowPersistManage:
    """
    Persisting data in workflow execution
    """

    def __init__(self):
        self._q = queue.Queue()

    def _stop(self):
        self._q.put(None)

    def _persist_worker(self, flask_app: Flask):
        listen_timeout = dify_config.APP_MAX_EXECUTION_TIME
        start_time = time.time()
        with flask_app.app_context():
            while True:
                try:
                    event = self._q.get(timeout=1)
                    if event is None:
                        break
                    if isinstance(event, WorkflowRunStartEvent):
                        self._handle_workflow_run_start(event)
                    elif isinstance(event, WorkflowRunSuccessEvent):
                        self._handle_workflow_run_success(event)
                        break
                    elif isinstance(event, WorkflowRunFailedEvent):
                        self._handle_workflow_run_failed(event)
                        break
                    elif isinstance(event, NodeExecutionStartEvent):
                        self._handle_node_execution_start(event.workflow_node_execution)
                    elif isinstance(event, NodeExecutionSuccessEvent):
                        self._handle_node_execution_success(event)
                    elif isinstance(event, NodeExecutionFailedEvent):
                        self._handle_node_execution_failed(event)
                except queue.Empty:
                    elapsed_time = time.time() - start_time
                    if elapsed_time >= listen_timeout:
                        break
                    continue
                except Exception:
                    logging.exception("Error in persist worker")

    def workflow_run_start(self, workflow_run: dict):
        """
        Workflow run start, Start persist worker
        :return:
        """
        worker_thread = threading.Thread(
            target=self._persist_worker,
            kwargs={
                "flask_app": current_app._get_current_object(),
            },
        )
        worker_thread.start()

        event = WorkflowRunStartEvent(workflow_run=workflow_run)
        self._q.put(event)

    def workflow_run_success(
        self,
        workflow_run_id: str,
        elapsed_time: float,
        total_tokens: int,
        total_steps: int,
        outputs: Optional[str],
        finished_at: datetime,
    ):
        """
        Workflow run success
        :param workflow_run_id: workflow run id
        :param elapsed_time: workflow run elapsed time
        :param total_tokens: total tokens
        :param total_steps: total steps
        :param outputs: outputs
        :param finished_at: workflow run finished time
        """
        event = WorkflowRunSuccessEvent(
            workflow_run_id=workflow_run_id,
            elapsed_time=elapsed_time,
            total_tokens=total_tokens,
            total_steps=total_steps,
            outputs=outputs,
            finished_at=finished_at,
        )
        self._q.put(event)
        self._stop()

    def workflow_run_failed(
        self,
        workflow_run_id: str,
        elapsed_time: float,
        total_tokens: int,
        total_steps: int,
        status: WorkflowRunStatus,
        error: str,
        finished_at: datetime,
    ):
        """
        Workflow run failed
        :param workflow_run_id: workflow run id
        :param elapsed_time: start time
        :param total_tokens: total tokens
        :param total_steps: total steps
        :param status: status
        :param error: error message
        :param finished_at: workflow run finished time
        :return:
        """
        event = WorkflowRunFailedEvent(
            workflow_run_id=workflow_run_id,
            elapsed_time=elapsed_time,
            total_tokens=total_tokens,
            total_steps=total_steps,
            status=status,
            error=error,
            finished_at=finished_at,
        )
        self._q.put(event)
        self._stop()

    def node_execution_start(self, workflow_node_execution: dict):
        """
        node execution start
        :param workflow_node_execution: workflow node execution
        :return:
        """
        event = NodeExecutionStartEvent(workflow_node_execution=workflow_node_execution)
        self._q.put(event)

    def node_execution_success(
        self,
        node_execution_id: str,
        inputs: Optional[dict],
        outputs: Optional[dict],
        execution_metadata: Optional[str],
        process_data: Optional[dict[str, Any]],
        finished_at: datetime,
        elapsed_time: float,
    ):
        """
        node execution success
        :param node_execution_id: workflow node execution id
        :param inputs: node inputs params
        :param outputs: node outputs params
        :param execution_metadata: node execution metadata
        :param process_data: node process data
        :param finished_at: node execution finished time
        :param elapsed_time: node execution elapsed time
        :return:
        """
        event = NodeExecutionSuccessEvent(
            node_execution_id=node_execution_id,
            inputs=inputs,
            outputs=outputs,
            execution_metadata=execution_metadata,
            process_data=process_data,
            finished_at=finished_at,
            elapsed_time=elapsed_time,
        )
        self._q.put(event)

    def node_execution_failed(
        self,
        node_execution_id: str,
        inputs: Optional[dict],
        outputs: Optional[dict],
        finished_at: datetime,
        elapsed_time: float,
        process_data: Optional[dict[str, Any]],
        error: str,
    ):
        """
        workflow node execution failed
        :param node_execution_id: workflow node execution id
        :param inputs: workflow node inputs params
        :param outputs: workflow node outputs params
        :param finished_at: workflow node execution finished time
        :param elapsed_time: workflow node execution elapsed time
        :param process_data: workflow node process data
        :param error: workflow node execution error message
        :return:
        """
        event = NodeExecutionFailedEvent(
            node_execution_id=node_execution_id,
            inputs=inputs,
            outputs=outputs,
            finished_at=finished_at,
            elapsed_time=elapsed_time,
            process_data=process_data,
            error=error,
        )
        self._q.put(event)

    @classmethod
    def _handle_workflow_run_start(cls, event: WorkflowRunStartEvent):
        workflow_run = WorkflowRun.from_dict(event.workflow_run)
        db.session.add(workflow_run)
        db.session.commit()
        db.session.close()

    @classmethod
    def _handle_workflow_run_success(cls, event: WorkflowRunSuccessEvent):
        workflow_run = WorkflowPersistManage._fetch_workflow_run(event.workflow_run_id)
        workflow_run.status = WorkflowRunStatus.SUCCEEDED.value
        workflow_run.outputs = event.outputs
        workflow_run.elapsed_time = event.elapsed_time
        workflow_run.total_tokens = event.total_tokens
        workflow_run.total_steps = event.total_steps
        workflow_run.finished_at = event.finished_at

        db.session.commit()
        db.session.close()

    @classmethod
    def _handle_workflow_run_failed(cls, event: WorkflowRunFailedEvent):
        workflow_run = WorkflowPersistManage._fetch_workflow_run(event.workflow_run_id)
        workflow_run.status = event.status.value
        workflow_run.error = event.error
        workflow_run.elapsed_time = event.elapsed_time
        workflow_run.total_tokens = event.total_tokens
        workflow_run.total_steps = event.total_steps
        workflow_run.finished_at = event.finished_at

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
            workflow_node_execution.error = event.error
            workflow_node_execution.finished_at = event.finished_at
            workflow_node_execution.elapsed_time = (
                workflow_node_execution.finished_at - workflow_node_execution.created_at
            ).total_seconds()
            db.session.commit()

        db.session.close()

    @staticmethod
    def _fetch_workflow_run(workflow_run_id: str) -> WorkflowRun:
        workflow_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == workflow_run_id).first()
        if not workflow_run:
            raise Exception(f"Workflow run not found: {workflow_run_id}")
        return workflow_run

    @staticmethod
    def _handle_node_execution_start(workflow_node_execution: dict):
        db.session.add(WorkflowNodeExecution(**workflow_node_execution))
        db.session.commit()
        db.session.close()

    @classmethod
    def _handle_node_execution_success(cls, event: NodeExecutionSuccessEvent):
        db.session.query(WorkflowNodeExecution).filter(WorkflowNodeExecution.id == event.node_execution_id).update(
            {
                WorkflowNodeExecution.status: WorkflowNodeExecutionStatus.SUCCEEDED.value,
                WorkflowNodeExecution.inputs: json.dumps(event.inputs) if event.inputs else None,
                WorkflowNodeExecution.process_data: json.dumps(event.process_data) if event.process_data else None,
                WorkflowNodeExecution.outputs: json.dumps(event.outputs) if event.outputs else None,
                WorkflowNodeExecution.execution_metadata: event.execution_metadata,
                WorkflowNodeExecution.finished_at: event.finished_at,
                WorkflowNodeExecution.elapsed_time: event.elapsed_time,
            }
        )

        db.session.commit()
        db.session.close()

    @classmethod
    def _handle_node_execution_failed(cls, event):
        db.session.query(WorkflowNodeExecution).filter(WorkflowNodeExecution.id == event.node_execution_id).update(
            {
                WorkflowNodeExecution.status: WorkflowNodeExecutionStatus.FAILED.value,
                WorkflowNodeExecution.error: event.error,
                WorkflowNodeExecution.inputs: json.dumps(event.inputs) if event.inputs else None,
                WorkflowNodeExecution.process_data: json.dumps(event.process_data) if event.process_data else None,
                WorkflowNodeExecution.outputs: json.dumps(event.outputs) if event.outputs else None,
                WorkflowNodeExecution.finished_at: event.finished_at,
                WorkflowNodeExecution.elapsed_time: event.elapsed_time,
            }
        )

        db.session.commit()
        db.session.close()
