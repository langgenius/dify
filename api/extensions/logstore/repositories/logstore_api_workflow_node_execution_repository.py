"""
LogStore implementation of DifyAPIWorkflowNodeExecutionRepository.

This module provides the LogStore-based implementation for service-layer
WorkflowNodeExecutionModel operations using Aliyun SLS LogStore.
"""

import logging
import time
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy.orm import sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories import safe_float, safe_int
from extensions.logstore.sql_escape import escape_identifier, escape_logstore_query_value
from models.workflow import WorkflowNodeExecutionModel
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository

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
    model.triggered_from = data.get("triggered_from") or ""
    model.node_id = data.get("node_id") or ""
    model.node_type = data.get("node_type") or ""
    model.status = data.get("status") or "running"  # Default status if missing
    model.title = data.get("title") or ""
    model.created_by_role = data.get("created_by_role") or ""
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
    created_at = data.get("created_at")
    if created_at:
        if isinstance(created_at, str):
            model.created_at = datetime.fromisoformat(created_at)
        elif isinstance(created_at, (int, float)):
            model.created_at = datetime.fromtimestamp(created_at)
        else:
            model.created_at = created_at
    else:
        # Provide default created_at if missing
        model.created_at = datetime.now()

    finished_at = data.get("finished_at")
    if finished_at:
        if isinstance(finished_at, str):
            model.finished_at = datetime.fromisoformat(finished_at)
        elif isinstance(finished_at, (int, float)):
            model.finished_at = datetime.fromtimestamp(finished_at)
        else:
            model.finished_at = finished_at

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
            session_maker: SQLAlchemy sessionmaker (unused, for compatibility with factory pattern)
        """
        logger.debug("LogstoreAPIWorkflowNodeExecutionRepository.__init__: initializing")
        self.logstore_client = AliyunLogStore()

    def get_node_last_execution(
        self,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
    ) -> WorkflowNodeExecutionModel | None:
        """
        Get the most recent execution for a specific node.

        Uses query syntax to get raw logs and selects the one with max log_version.
        Returns the most recent execution ordered by created_at.
        """
        logger.debug(
            "get_node_last_execution: tenant_id=%s, app_id=%s, workflow_id=%s, node_id=%s",
            tenant_id,
            app_id,
            workflow_id,
            node_id,
        )
        try:
            # Escape parameters to prevent SQL injection
            escaped_tenant_id = escape_identifier(tenant_id)
            escaped_app_id = escape_identifier(app_id)
            escaped_workflow_id = escape_identifier(workflow_id)
            escaped_node_id = escape_identifier(node_id)

            # Check if PG protocol is supported
            if self.logstore_client.supports_pg_protocol:
                # Use PG protocol with SQL query (get latest version of each record)
                sql_query = f"""
                    SELECT * FROM (
                        SELECT *, 
                            ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) as rn
                        FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                        WHERE tenant_id = '{escaped_tenant_id}' 
                          AND app_id = '{escaped_app_id}' 
                          AND workflow_id = '{escaped_workflow_id}' 
                          AND node_id = '{escaped_node_id}'
                          AND __time__ > 0
                    ) AS subquery WHERE rn = 1
                    LIMIT 100
                """
                results = self.logstore_client.execute_sql(
                    sql=sql_query,
                    logstore=AliyunLogStore.workflow_node_execution_logstore,
                )
            else:
                # Use SDK with LogStore query syntax
                query = (
                    f"tenant_id: {escaped_tenant_id} and app_id: {escaped_app_id} "
                    f"and workflow_id: {escaped_workflow_id} and node_id: {escaped_node_id}"
                )
                from_time = 0
                to_time = int(time.time())  # now

                results = self.logstore_client.get_logs(
                    logstore=AliyunLogStore.workflow_node_execution_logstore,
                    from_time=from_time,
                    to_time=to_time,
                    query=query,
                    line=100,
                    reverse=False,
                )

            if not results:
                return None

            # For SDK mode, group by id and select the one with max log_version for each group
            # For PG mode, this is already done by the SQL query
            if not self.logstore_client.supports_pg_protocol:
                id_to_results: dict[str, list[dict[str, Any]]] = {}
                for row in results:
                    row_id = row.get("id")
                    if row_id:
                        if row_id not in id_to_results:
                            id_to_results[row_id] = []
                        id_to_results[row_id].append(row)

                # For each id, select the row with max log_version
                deduplicated_results = []
                for rows in id_to_results.values():
                    if len(rows) > 1:
                        max_row = max(rows, key=lambda x: int(x.get("log_version", 0)))
                    else:
                        max_row = rows[0]
                    deduplicated_results.append(max_row)
            else:
                # For PG mode, results are already deduplicated by the SQL query
                deduplicated_results = results

            # Sort by created_at DESC and return the most recent one
            deduplicated_results.sort(
                key=lambda x: x.get("created_at", 0) if isinstance(x.get("created_at"), (int, float)) else 0,
                reverse=True,
            )

            if deduplicated_results:
                return _dict_to_workflow_node_execution_model(deduplicated_results[0])

            return None

        except Exception:
            logger.exception("Failed to get node last execution from LogStore")
            raise

    def get_executions_by_workflow_run(
        self,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get all node executions for a specific workflow run.

        Uses query syntax to get raw logs and selects the one with max log_version for each node execution.
        Ordered by index DESC for trace visualization.
        """
        logger.debug(
            "[LogStore] get_executions_by_workflow_run: tenant_id=%s, app_id=%s, workflow_run_id=%s",
            tenant_id,
            app_id,
            workflow_run_id,
        )
        try:
            # Escape parameters to prevent SQL injection
            escaped_tenant_id = escape_identifier(tenant_id)
            escaped_app_id = escape_identifier(app_id)
            escaped_workflow_run_id = escape_identifier(workflow_run_id)

            # Check if PG protocol is supported
            if self.logstore_client.supports_pg_protocol:
                # Use PG protocol with SQL query (get latest version of each record)
                sql_query = f"""
                    SELECT * FROM (
                        SELECT *, 
                            ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) as rn
                        FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                        WHERE tenant_id = '{escaped_tenant_id}' 
                          AND app_id = '{escaped_app_id}' 
                          AND workflow_run_id = '{escaped_workflow_run_id}'
                          AND __time__ > 0
                    ) AS subquery WHERE rn = 1
                    LIMIT 1000
                """
                results = self.logstore_client.execute_sql(
                    sql=sql_query,
                    logstore=AliyunLogStore.workflow_node_execution_logstore,
                )
            else:
                # Use SDK with LogStore query syntax
                query = (
                    f"tenant_id: {escaped_tenant_id} and app_id: {escaped_app_id} "
                    f"and workflow_run_id: {escaped_workflow_run_id}"
                )
                from_time = 0
                to_time = int(time.time())  # now

                results = self.logstore_client.get_logs(
                    logstore=AliyunLogStore.workflow_node_execution_logstore,
                    from_time=from_time,
                    to_time=to_time,
                    query=query,
                    line=1000,  # Get more results for node executions
                    reverse=False,
                )

            if not results:
                return []

            # For SDK mode, group by id and select the one with max log_version for each group
            # For PG mode, this is already done by the SQL query
            models = []
            if not self.logstore_client.supports_pg_protocol:
                id_to_results: dict[str, list[dict[str, Any]]] = {}
                for row in results:
                    row_id = row.get("id")
                    if row_id:
                        if row_id not in id_to_results:
                            id_to_results[row_id] = []
                        id_to_results[row_id].append(row)

                # For each id, select the row with max log_version
                for rows in id_to_results.values():
                    if len(rows) > 1:
                        max_row = max(rows, key=lambda x: int(x.get("log_version", 0)))
                    else:
                        max_row = rows[0]

                    model = _dict_to_workflow_node_execution_model(max_row)
                    if model and model.id:  # Ensure model is valid
                        models.append(model)
            else:
                # For PG mode, results are already deduplicated by the SQL query
                for row in results:
                    model = _dict_to_workflow_node_execution_model(row)
                    if model and model.id:  # Ensure model is valid
                        models.append(model)

            # Sort by index DESC for trace visualization
            models.sort(key=lambda x: x.index, reverse=True)

            return models

        except Exception:
            logger.exception("Failed to get executions by workflow run from LogStore")
            raise

    def get_execution_by_id(
        self,
        execution_id: str,
        tenant_id: str | None = None,
    ) -> WorkflowNodeExecutionModel | None:
        """
        Get a workflow node execution by its ID.
        Uses query syntax to get raw logs and selects the one with max log_version.
        """
        logger.debug("get_execution_by_id: execution_id=%s, tenant_id=%s", execution_id, tenant_id)
        try:
            # Escape parameters to prevent SQL injection
            escaped_execution_id = escape_identifier(execution_id)

            # Check if PG protocol is supported
            if self.logstore_client.supports_pg_protocol:
                # Use PG protocol with SQL query (get latest version of record)
                if tenant_id:
                    escaped_tenant_id = escape_identifier(tenant_id)
                    tenant_filter = f"AND tenant_id = '{escaped_tenant_id}'"
                else:
                    tenant_filter = ""

                sql_query = f"""
                    SELECT * FROM (
                        SELECT *, 
                            ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) as rn
                        FROM "{AliyunLogStore.workflow_node_execution_logstore}"
                        WHERE id = '{escaped_execution_id}' {tenant_filter} AND __time__ > 0
                    ) AS subquery WHERE rn = 1
                    LIMIT 1
                """
                results = self.logstore_client.execute_sql(
                    sql=sql_query,
                    logstore=AliyunLogStore.workflow_node_execution_logstore,
                )
            else:
                # Use SDK with LogStore query syntax
                # Note: Values must be quoted in LogStore query syntax to prevent injection
                if tenant_id:
                    query = (
                        f"id:{escape_logstore_query_value(execution_id)} "
                        f"and tenant_id:{escape_logstore_query_value(tenant_id)}"
                    )
                else:
                    query = f"id:{escape_logstore_query_value(execution_id)}"

                from_time = 0
                to_time = int(time.time())  # now

                results = self.logstore_client.get_logs(
                    logstore=AliyunLogStore.workflow_node_execution_logstore,
                    from_time=from_time,
                    to_time=to_time,
                    query=query,
                    line=100,
                    reverse=False,
                )

            if not results:
                return None

            # For PG mode, result is already the latest version
            # For SDK mode, if multiple results, select the one with max log_version
            if self.logstore_client.supports_pg_protocol or len(results) == 1:
                return _dict_to_workflow_node_execution_model(results[0])
            else:
                max_result = max(results, key=lambda x: int(x.get("log_version", 0)))
                return _dict_to_workflow_node_execution_model(max_result)

        except Exception:
            logger.exception("Failed to get execution by ID from LogStore: execution_id=%s", execution_id)
            raise
