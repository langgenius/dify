"""
LogStore implementation of DifyAPIWorkflowNodeExecutionRepository.

This module provides the LogStore-based implementation for service-layer
WorkflowNodeExecutionModel operations using Aliyun SLS LogStore.
"""

import logging
from collections.abc import Mapping, Sequence
from typing import Any, override

from sqlalchemy.orm import Session, sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.workflow.logstore.queries import latest_records, node_execution_page
from repositories.workflow.logstore.records import node_execution_model_from_log
from repositories.workflow.logstore.schema import WORKFLOW_NODE_EXECUTION_LOGSTORE
from repositories.workflow.node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.workflow_run_control import apply_workflow_stop_to_node, get_stopped_workflow_run
from services.workflow.node_execution_queries import WorkflowNodeExecutionSnapshot

logger = logging.getLogger(__name__)


class LogstoreWorkflowNodeExecutionRepository(DifyAPISQLAlchemyWorkflowNodeExecutionRepository):
    """
    LogStore implementation of DifyAPIWorkflowNodeExecutionRepository.

    Provides service-layer database operations for WorkflowNodeExecutionModel
    using LogStore SQL queries with optimized deduplication strategies.
    """

    def __init__(self, session_maker: sessionmaker[Session]):
        """Read logs from LogStore and keep retention operations on the injected database."""
        super().__init__(session_maker=session_maker)
        logger.debug("LogstoreWorkflowNodeExecutionRepository.__init__: initializing")
        self.logstore_client = AliyunLogStore()

    @override
    def get_execution_snapshots_by_workflow_run(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        triggered_from: str,
        workflow_run_id: str,
    ) -> Sequence[WorkflowNodeExecutionSnapshot]:
        executions = self._load_executions_by_workflow_run(tenant_id, app_id, workflow_run_id)
        scoped = (
            execution
            for execution in executions
            if execution.tenant_id == tenant_id
            and execution.app_id == app_id
            and execution.workflow_id == workflow_id
            and execution.triggered_from == triggered_from
            and execution.workflow_run_id == workflow_run_id
        )
        return [
            WorkflowNodeExecutionSnapshot.from_execution(row)
            for row in sorted(scoped, key=lambda row: (row.created_at, row.index))
        ]

    def _apply_stopped_run(
        self,
        executions: Sequence[WorkflowNodeExecutionModel],
        tenant_id: str,
        workflow_run_id: str,
    ) -> None:
        with self._session_maker() as session:
            stopped = get_stopped_workflow_run(session, tenant_id=tenant_id, workflow_run_id=workflow_run_id)
            for execution in executions:
                apply_workflow_stop_to_node(execution, stopped)

    @override
    def load_full_process_data(self, execution: WorkflowNodeExecutionModel) -> Mapping[str, Any] | None:
        """Return complete Process Data already stored inline by LogStore."""
        return execution.process_data_dict

    @override
    def get_node_last_execution(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
    ) -> WorkflowNodeExecutionModel | None:
        current = latest_records(
            WORKFLOW_NODE_EXECUTION_LOGSTORE,
            {
                "tenant_id": tenant_id,
                "app_id": app_id,
                "workflow_id": workflow_id,
                "node_id": node_id,
            },
        )
        rows = self.logstore_client.execute_sql(
            sql=(
                f"SELECT * FROM ({current}) nodes WHERE status != '{WorkflowNodeExecutionStatus.PAUSED.value}' "
                f"AND triggered_from != '{WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL.value}' "
                "ORDER BY created_at DESC, id DESC LIMIT 1"
            ),
            logstore=WORKFLOW_NODE_EXECUTION_LOGSTORE,
        )
        if not rows:
            return None
        execution = node_execution_model_from_log(rows[0])
        if execution.workflow_run_id:
            self._apply_stopped_run([execution], tenant_id, execution.workflow_run_id)
        return execution

    @override
    def get_executions_by_workflow_run(
        self,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        return [
            execution
            for execution in self._load_executions_by_workflow_run(tenant_id, app_id, workflow_run_id)
            if execution.triggered_from != WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
        ]

    @override
    def get_workflow_tool_executions(
        self,
        tenant_id: str,
        workflow_run_id: str,
        parent_node_execution_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        executions = self._load_executions_by_owner(tenant_id, workflow_run_id)
        parent = next(
            (
                execution
                for execution in executions
                if execution.node_type == BuiltinNodeTypes.TOOL
                and parent_node_execution_id in (execution.id, execution.node_execution_id)
            ),
            None,
        )
        if parent is None:
            return []
        parent_execution_id = parent.node_execution_id or parent.id
        return sorted(
            (
                execution
                for execution in executions
                if execution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL
                and execution.triggered_from_node_execution_id == parent_execution_id
                and execution.triggered_from_workflow_id == parent.workflow_id
            ),
            key=lambda execution: (execution.created_at, execution.index),
        )

    def _load_executions_by_workflow_run(
        self,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        return self._load_executions_by_owner(tenant_id, workflow_run_id, app_id=app_id)

    def _load_executions_by_owner(
        self,
        tenant_id: str,
        workflow_run_id: str,
        *,
        app_id: str | None = None,
    ) -> list[WorkflowNodeExecutionModel]:
        owner = {"tenant_id": tenant_id, "workflow_run_id": workflow_run_id}
        if app_id is not None:
            owner["app_id"] = app_id
        current = latest_records(
            WORKFLOW_NODE_EXECUTION_LOGSTORE,
            owner,
        )
        executions: list[WorkflowNodeExecutionModel] = []
        page_size = 1000
        while True:
            rows = self.logstore_client.execute_sql(
                sql=node_execution_page(
                    current,
                    order_by=["created_at ASC", '"index" ASC', "id ASC"],
                    include_paused=True,
                    offset=len(executions),
                    count=page_size,
                ),
                logstore=WORKFLOW_NODE_EXECUTION_LOGSTORE,
            )
            executions.extend(node_execution_model_from_log(row) for row in rows)
            if len(rows) < page_size:
                self._apply_stopped_run(executions, tenant_id, workflow_run_id)
                return executions

    @override
    def get_execution_by_id(self, execution_id: str, tenant_id: str | None = None) -> WorkflowNodeExecutionModel | None:
        owner = {"id": execution_id}
        if tenant_id is not None:
            owner["tenant_id"] = tenant_id
        current = latest_records(WORKFLOW_NODE_EXECUTION_LOGSTORE, owner)
        rows = self.logstore_client.execute_sql(sql=f"{current} LIMIT 1", logstore=WORKFLOW_NODE_EXECUTION_LOGSTORE)
        if rows and all(rows[0].get(key) == value for key, value in owner.items()):
            execution = node_execution_model_from_log(rows[0])
            if execution.workflow_run_id:
                self._apply_stopped_run([execution], execution.tenant_id, execution.workflow_run_id)
            return execution
        return None
