"""
LogStore implementation of DifyAPIWorkflowNodeExecutionRepository.

This module provides the LogStore-based implementation for service-layer
WorkflowNodeExecutionModel operations using Aliyun SLS LogStore.
"""

import logging
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, override

from sqlalchemy.orm import sessionmaker

from core.workflow.node_execution_process_data import WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories import safe_float, safe_int
from extensions.logstore.sql_escape import escape_identifier, escape_logstore_query_value
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.api_workflow_node_execution_repository import (
    DifyAPIWorkflowNodeExecutionRepository,
    WorkflowNodeExecutionSnapshot,
)
from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)

logger = logging.getLogger(__name__)


def _dict_to_workflow_node_execution_model(data: dict[str, Any]) -> WorkflowNodeExecutionModel:
    """
    Convert LogStore result dictionary to WorkflowNodeExecutionModel instance.

    Args:
        data: Dictionary from LogStore query result

    Returns:
        WorkflowNodeExecutionModel instance (detached from session)

    Note:
        The returned model is not attached to any SQLAlchemy session.
        Relationship fields (like offload_data) are not loaded from LogStore.
    """
    logger.debug("_dict_to_workflow_node_execution_model: data keys=%s", list(data.keys())[:5])
    # Create model instance without session
    model = WorkflowNodeExecutionModel()

    # Map all required fields with validation
    # Critical fields - must not be None
    model.id = data.get("id") or ""
    model.tenant_id = data.get("tenant_id") or ""
    model.app_id = data.get("app_id") or ""
    model.workflow_id = data.get("workflow_id") or ""
    triggered_from_val = data.get("triggered_from")
    try:
        model.triggered_from = (
            WorkflowNodeExecutionTriggeredFrom(str(triggered_from_val))
            if triggered_from_val
            else WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        )
    except ValueError:
        logger.warning("Invalid triggered_from value: %s, falling back to WORKFLOW_RUN", triggered_from_val)
        model.triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    model.node_id = data.get("node_id") or ""
    model.node_type = data.get("node_type") or ""
    model.status = WorkflowNodeExecutionStatus(data.get("status") or "running")
    model.title = data.get("title") or ""
    created_by_role_val = data.get("created_by_role")
    try:
        model.created_by_role = (
            CreatorUserRole(str(created_by_role_val)) if created_by_role_val else CreatorUserRole.ACCOUNT
        )
    except ValueError:
        logger.warning("Invalid created_by_role value: %s, falling back to ACCOUNT", created_by_role_val)
        model.created_by_role = CreatorUserRole.ACCOUNT
    model.created_by = data.get("created_by") or ""

    model.index = safe_int(data.get("index", 0))
    model.elapsed_time = safe_float(data.get("elapsed_time", 0))

    # Optional fields
    model.workflow_run_id = data.get("workflow_run_id")
    model.predecessor_node_id = data.get("predecessor_node_id")
    model.node_execution_id = data.get("node_execution_id")
    model.inputs = data.get("inputs")
    model.process_data = data.get("process_data")
    model.outputs = data.get("outputs")
    model.error = data.get("error")
    model.execution_metadata = data.get("execution_metadata")

    # Handle datetime fields
    # Every branch must yield naive UTC, matching what the database path stores.
    created_at = data.get("created_at")
    match created_at:
        case None:
            # Provide default created_at if missing
            model.created_at = naive_utc_now()
        case str():
            model.created_at = ensure_naive_utc(datetime.fromisoformat(created_at))
        case int() | float():
            model.created_at = datetime.fromtimestamp(created_at, tz=UTC).replace(tzinfo=None)
        case _:
            model.created_at = ensure_naive_utc(created_at)

    finished_at = data.get("finished_at")
    match finished_at:
        case None:
            ...
        case str():
            model.finished_at = ensure_naive_utc(datetime.fromisoformat(finished_at))
        case int() | float():
            model.finished_at = datetime.fromtimestamp(finished_at, tz=UTC).replace(tzinfo=None)
        case _:
            model.finished_at = ensure_naive_utc(finished_at)

    return model


class LogstoreAPIWorkflowNodeExecutionRepository(DifyAPIWorkflowNodeExecutionRepository):
    """
    LogStore implementation of DifyAPIWorkflowNodeExecutionRepository.

    Provides service-layer database operations for WorkflowNodeExecutionModel
    using LogStore SQL queries with optimized deduplication strategies.
    """

    def __init__(self, session_maker: sessionmaker | None = None):
        """
        Initialize the repository with LogStore client.

        Args:
            session_maker: SQLAlchemy sessionmaker for synchronous Agent caller records.
        """
        logger.debug("LogstoreAPIWorkflowNodeExecutionRepository.__init__: initializing")
        self.logstore_client = AliyunLogStore()
        self._session_maker = session_maker

    @override
    def delete_executions_by_app(self, tenant_id: str, app_id: str, batch_size: int = 1000) -> int:
        """Delete SQL caller records; append-only Logstore traces retain their configured TTL."""
        if self._session_maker is None:
            raise ValueError("session_maker is required to delete SQL workflow caller records")
        return DifyAPISQLAlchemyWorkflowNodeExecutionRepository(self._session_maker).delete_executions_by_app(
            tenant_id=tenant_id, app_id=app_id, batch_size=batch_size
        )

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
        """Return the most recent visible, non-paused execution after selecting each latest version."""
        scope = {"tenant_id": tenant_id, "app_id": app_id, "workflow_id": workflow_id, "node_id": node_id}
        filters = " AND ".join(f"{key} = '{escape_identifier(value)}'" for key, value in scope.items())
        search = " and ".join(f"{key}: {escape_logstore_query_value(value)}" for key, value in scope.items())
        results = self.logstore_client.execute_sql(
            sql=f"""
                SELECT * FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                    FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                    WHERE {filters} AND __time__ > 0
                ) AS executions WHERE rn = 1
                  AND (triggered_from IS NULL
                       OR triggered_from != '{WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL.value}')
                  AND (status IS NULL OR status != '{WorkflowNodeExecutionStatus.PAUSED.value}')
                ORDER BY created_at DESC LIMIT 1
            """,
            logstore=AliyunLogStore.workflow_node_execution_logstore,
            query=search,
        )
        return _dict_to_workflow_node_execution_model(results[0]) if results else None

    @override
    def get_executions_by_workflow_run(
        self, tenant_id: str, app_id: str, workflow_run_id: str
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """Return visible terminal trace records, newest index first."""
        executions = self._get_run_executions(tenant_id, app_id, workflow_run_id)
        return sorted(
            (execution for execution in executions if execution.status != WorkflowNodeExecutionStatus.PAUSED),
            key=lambda execution: execution.index,
            reverse=True,
        )

    @override
    def get_execution_snapshots_by_workflow_run(
        self, tenant_id: str, app_id: str, workflow_id: str, triggered_from: str, workflow_run_id: str
    ) -> Sequence[WorkflowNodeExecutionSnapshot]:
        return [
            WorkflowNodeExecutionSnapshot.from_execution(execution)
            for execution in self._get_run_executions(
                tenant_id, app_id, workflow_run_id, workflow_id=workflow_id, triggered_from=triggered_from
            )
        ]

    def _get_run_executions(
        self,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
        *,
        workflow_id: str | None = None,
        triggered_from: str | None = None,
    ) -> list[WorkflowNodeExecutionModel]:
        """Read latest versions through the shared SQL/SDK adapter; snapshots omit payloads."""
        scope = {"tenant_id": tenant_id, "app_id": app_id, "workflow_run_id": workflow_run_id}
        if workflow_id is not None:
            scope["workflow_id"] = workflow_id
        filters = " AND ".join(f"{key} = '{escape_identifier(value)}'" for key, value in scope.items())
        search = " and ".join(f"{key}: {escape_logstore_query_value(value)}" for key, value in scope.items())
        origin = (
            f"triggered_from = '{escape_identifier(triggered_from)}'"
            if triggered_from is not None
            else f"(triggered_from IS NULL OR triggered_from != '{WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL}')"
        )
        columns = (
            'id, node_execution_id, node_id, node_type, title, "index", status, elapsed_time, '
            "created_at, finished_at, execution_metadata"
            if workflow_id is not None
            else "*"
        )
        executions: list[WorkflowNodeExecutionModel] = []
        offset = 0
        to_time = int(time.time())
        while True:
            page = self.logstore_client.execute_sql(
                sql=f"""
                    SELECT {columns} FROM (
                        SELECT {columns}, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                        FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                        WHERE {filters} AND {origin} AND __time__ > 0
                    ) AS executions WHERE rn = 1 ORDER BY created_at, "index", id LIMIT 1000 OFFSET {offset}
                """,
                logstore=AliyunLogStore.workflow_node_execution_logstore,
                query=search,
                to_time=to_time,
            )
            for row in page:
                execution = _dict_to_workflow_node_execution_model(row)
                if workflow_id is not None and row.get("elapsed_time") is None:
                    execution.elapsed_time = (
                        (execution.finished_at - execution.created_at).total_seconds() if execution.finished_at else 0.0
                    )
                executions.append(execution)
            if len(page) < 1000:
                return executions
            offset += len(page)

    @override
    def get_workflow_tool_executions(
        self,
        tenant_id: str,
        workflow_run_id: str,
        parent_node_execution_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        scope = (
            f"tenant_id = '{escape_identifier(tenant_id)}' "
            f"AND workflow_run_id = '{escape_identifier(workflow_run_id)}' AND __time__ > 0"
        )
        search_query = (
            f"tenant_id: {escape_logstore_query_value(tenant_id)} "
            f"and workflow_run_id: {escape_logstore_query_value(workflow_run_id)}"
        )
        requested_id = escape_identifier(parent_node_execution_id)
        to_time = int(time.time())
        parents = self.logstore_client.execute_sql(
            sql=f"""
                SELECT id, node_execution_id FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                WHERE {scope} AND node_type = '{BuiltinNodeTypes.TOOL}'
                  AND (id = '{requested_id}' OR node_execution_id = '{requested_id}')
                ORDER BY log_version DESC LIMIT 1
            """,
            logstore=AliyunLogStore.workflow_node_execution_logstore,
            query=search_query,
            to_time=to_time,
        )
        if not parents:
            return []
        parent_execution_id = escape_identifier(parents[0].get("node_execution_id") or parents[0]["id"])
        children: list[WorkflowNodeExecutionModel] = []
        offset = 0
        while True:
            page = self.logstore_client.execute_sql(
                sql=f"""
                    SELECT * FROM (
                        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                        FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                        WHERE {scope}
                          AND triggered_from = '{WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL.value}'
                          AND json_extract_scalar(process_data, '$.{WORKFLOW_TOOL_PARENT_EXECUTION_ID_KEY}')
                              = '{parent_execution_id}'
                    ) AS executions WHERE rn = 1
                    ORDER BY created_at, "index", id LIMIT 1000 OFFSET {offset}
                """,
                logstore=AliyunLogStore.workflow_node_execution_logstore,
                query=search_query,
                to_time=to_time,
            )
            children.extend(_dict_to_workflow_node_execution_model(row) for row in page)
            if len(page) < 1000:
                return children
            offset += len(page)

    @override
    def get_execution_by_id(
        self,
        execution_id: str,
        tenant_id: str | None = None,
    ) -> WorkflowNodeExecutionModel | None:
        """Return the latest version of an execution, optionally scoped to its tenant."""
        scope = {"id": execution_id}
        if tenant_id:
            scope["tenant_id"] = tenant_id
        filters = " AND ".join(f"{key} = '{escape_identifier(value)}'" for key, value in scope.items())
        search = " and ".join(f"{key}: {escape_logstore_query_value(value)}" for key, value in scope.items())
        results = self.logstore_client.execute_sql(
            sql=f"""
                SELECT * FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                WHERE {filters} AND __time__ > 0
                ORDER BY log_version DESC LIMIT 1
            """,
            logstore=AliyunLogStore.workflow_node_execution_logstore,
            query=search,
        )
        return _dict_to_workflow_node_execution_model(results[0]) if results else None
