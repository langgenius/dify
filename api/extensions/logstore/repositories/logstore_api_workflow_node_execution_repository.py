"""
LogStore implementation of DifyAPIWorkflowNodeExecutionRepository.

This module provides the LogStore-based implementation for service-layer
WorkflowNodeExecutionModel operations using Aliyun SLS LogStore.
"""

import logging
import time
from collections.abc import Sequence
from typing import Any

from sqlalchemy.orm import sessionmaker

from core.workflow.enums import WorkflowNodeExecutionStatus
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories import dict_to_workflow_node_execution_model
from extensions.logstore.sql_escape import escape_identifier, escape_logstore_query_value
from models.workflow import WorkflowNodeExecutionModel
from repositories.api_workflow_node_execution_repository import DifyAPIWorkflowNodeExecutionRepository

logger = logging.getLogger(__name__)


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

            for row in deduplicated_results:
                model = dict_to_workflow_node_execution_model(row)
                if model.status != WorkflowNodeExecutionStatus.PAUSED:
                    return model

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

                    model = dict_to_workflow_node_execution_model(max_row)
                    if model and model.id:  # Ensure model is valid
                        models.append(model)
            else:
                # For PG mode, results are already deduplicated by the SQL query
                for row in results:
                    model = dict_to_workflow_node_execution_model(row)
                    if model and model.id:  # Ensure model is valid
                        models.append(model)

            models = [model for model in models if model.status != WorkflowNodeExecutionStatus.PAUSED]

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

        Strategy:
        1. Try LogStore query first
        2. If not found, check debug cache (for SINGLE_STEP executions)
        3. Return None if not found anywhere

        The debug cache helps handle LogStore indexing delays during node debugging.
        """
        logger.debug("get_execution_by_id: execution_id=%s, tenant_id=%s", execution_id, tenant_id)

        from extensions.logstore.debug_execution_cache import DebugExecutionCache

        try:
            result = self._query_from_logstore(execution_id, tenant_id)
            if result is not None:
                return result

            # Check debug cache as fallback
            # This helps when LogStore indexing is delayed (typically for SINGLE_STEP executions)
            cached_result = DebugExecutionCache.get(execution_id)
            if cached_result is not None:
                logger.info(
                    "Found execution in debug cache (LogStore indexing delay): execution_id=%s, tenant_id=%s",
                    execution_id,
                    tenant_id,
                )
                return cached_result

            logger.warning(
                "Execution not found in LogStore or debug cache: execution_id=%s, tenant_id=%s", execution_id, tenant_id
            )
            return None

        except Exception:
            logger.exception("Failed to get execution by ID: execution_id=%s", execution_id)
            # Try cache as last resort on any error
            cached_result = DebugExecutionCache.get(execution_id)
            if cached_result is not None:
                logger.info("Returning cached result after LogStore error: %s", execution_id)
                return cached_result
            raise

    def _query_from_logstore(
        self, execution_id: str, tenant_id: str | None = None
    ) -> WorkflowNodeExecutionModel | None:
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
                return dict_to_workflow_node_execution_model(results[0])
            else:
                max_result = max(results, key=lambda x: int(x.get("log_version", 0)))
                return dict_to_workflow_node_execution_model(max_result)

        except Exception:
            logger.exception("Failed to get execution by ID from LogStore: execution_id=%s", execution_id)
            raise
