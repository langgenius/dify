"""Read the latest LogStore node executions without constructing a writer."""

import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any, override

from core.ops.utils import JSON_DICT_ADAPTER
from core.repositories.factory import OrderConfig, WorkflowNodeExecutionQuery
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories import safe_float, safe_int
from extensions.logstore.sql_escape import escape_identifier
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus

logger = logging.getLogger(__name__)


def _dict_to_workflow_node_execution(data: dict[str, Any]) -> WorkflowNodeExecution:
    """
    Convert LogStore result dictionary to WorkflowNodeExecution domain model.

    Args:
        data: Dictionary from LogStore query result

    Returns:
        WorkflowNodeExecution domain model instance
    """
    logger.debug("_dict_to_workflow_node_execution: data keys=%s", list(data.keys())[:5])
    # Parse JSON fields
    inputs = JSON_DICT_ADAPTER.validate_json(data.get("inputs") or "{}")
    process_data = JSON_DICT_ADAPTER.validate_json(data.get("process_data") or "{}")
    outputs = JSON_DICT_ADAPTER.validate_json(data.get("outputs") or "{}")
    metadata = JSON_DICT_ADAPTER.validate_json(data.get("execution_metadata") or "{}")

    # Convert metadata to domain enum keys
    domain_metadata = {}
    for k, v in metadata.items():
        try:
            domain_metadata[WorkflowNodeExecutionMetadataKey(k)] = v
        except ValueError:
            # Skip invalid metadata keys
            continue

    # Convert status to domain enum
    status = WorkflowNodeExecutionStatus(data.get("status", "running"))

    # Parse datetime fields
    created_at = datetime.fromisoformat(data.get("created_at", "")) if data.get("created_at") else datetime.now()
    finished_at = datetime.fromisoformat(data.get("finished_at", "")) if data.get("finished_at") else None

    return WorkflowNodeExecution(
        id=data.get("id", ""),
        node_execution_id=data.get("node_execution_id"),
        workflow_id=data.get("workflow_id", ""),
        workflow_execution_id=data.get("workflow_run_id"),
        index=safe_int(data.get("index", 0)),
        predecessor_node_id=data.get("predecessor_node_id"),
        node_id=data.get("node_id", ""),
        node_type=data.get("node_type", "start"),
        title=data.get("title", ""),
        inputs=inputs,
        process_data=process_data,
        outputs=outputs,
        status=status,
        error=data.get("error"),
        elapsed_time=safe_float(data.get("elapsed_time", 0.0)),
        metadata=domain_metadata,
        created_at=created_at,
        finished_at=finished_at,
    )


class LogstoreWorkflowNodeExecutionQueryRepository(WorkflowNodeExecutionQuery):
    """Query append-only execution records within the tenant and optional app scope."""

    def __init__(
        self,
        tenant_id: str,
        app_id: str | None,
        *,
        logstore_client: AliyunLogStore | None = None,
    ) -> None:
        if not tenant_id:
            raise ValueError("tenant_id is required")
        self._tenant_id = tenant_id
        self._app_id = app_id
        self.logstore_client = logstore_client if logstore_client is not None else AliyunLogStore()

    @override
    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all node executions for a workflow execution.
        Uses LogStore SQL query with window function to get the latest version of each node execution.
        This ensures we only get the most recent version of each node execution record.
        Args:
            workflow_execution_id: The workflow execution identifier
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of workflow node execution instances

        Note:
            This method uses ROW_NUMBER() window function partitioned by node_execution_id
            to get the latest version (highest log_version) of each node execution.
        """
        logger.debug(
            "get_by_workflow_execution: workflow_execution_id=%s, order_config=%s",
            workflow_execution_id,
            order_config,
        )
        # Build SQL query with deduplication using window function
        # ROW_NUMBER() OVER (PARTITION BY node_execution_id ORDER BY log_version DESC)
        # ensures we get the latest version of each node execution

        # Escape parameters to prevent SQL injection
        escaped_workflow_execution_id = escape_identifier(workflow_execution_id)
        escaped_tenant_id = escape_identifier(self._tenant_id)

        # Build ORDER BY clause for outer query
        order_clause = ""
        if order_config and order_config.order_by:
            order_fields = []
            for field in order_config.order_by:
                # Map domain field names to logstore field names if needed
                field_name = field
                if order_config.order_direction == "desc":
                    order_fields.append(f"{field_name} DESC")
                else:
                    order_fields.append(f"{field_name} ASC")
            if order_fields:
                order_clause = "ORDER BY " + ", ".join(order_fields)

        # Build app_id filter for subquery
        app_id_filter = ""
        if self._app_id:
            escaped_app_id = escape_identifier(self._app_id)
            app_id_filter = f" AND app_id='{escaped_app_id}'"

        # Use window function to get latest version of each node execution
        sql = f"""
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY node_execution_id ORDER BY log_version DESC) AS rn
                FROM {AliyunLogStore.workflow_node_execution_logstore}
                WHERE workflow_run_id='{escaped_workflow_execution_id}'
                  AND tenant_id='{escaped_tenant_id}'
                  {app_id_filter}
            ) t
            WHERE rn = 1
        """

        if order_clause:
            sql += f" {order_clause}"

        try:
            # Execute SQL query
            results = self.logstore_client.execute_sql(
                sql=sql,
                query="*",
                logstore=AliyunLogStore.workflow_node_execution_logstore,
            )

            # Convert LogStore results to WorkflowNodeExecution domain models
            executions = []
            for row in results:
                try:
                    execution = _dict_to_workflow_node_execution(row)
                    executions.append(execution)
                except Exception as e:
                    logger.warning("Failed to convert row to WorkflowNodeExecution: %s, row=%s", e, row)
                    continue

            return executions

        except Exception:
            logger.exception(
                "Failed to retrieve node executions from LogStore: workflow_execution_id=%s",
                workflow_execution_id,
            )
            raise
