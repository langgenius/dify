"""
LogStore implementation of DifyAPIWorkflowNodeExecutionRepository.

This module provides the LogStore-based implementation for service-layer
WorkflowNodeExecutionModel operations using Aliyun SLS LogStore.
"""

import logging
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy.orm import sessionmaker

from extensions.logstore.aliyun_logstore import AliyunLogStore
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

    # Numeric fields with defaults
    model.index = int(data.get("index", 0))
    model.elapsed_time = float(data.get("elapsed_time", 0))

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

        Uses window function to get latest version, ordered by created_at.
        """
        query = f"""
            * | SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                FROM {AliyunLogStore.workflow_node_execution_logstore}
                WHERE tenant_id='{tenant_id}'
                  AND app_id='{app_id}'
                  AND workflow_id='{workflow_id}'
                  AND node_id='{node_id}'
            ) t
            WHERE rn = 1
            ORDER BY created_at DESC
            LIMIT 1
        """

        try:
            results = self.logstore_client.execute_sql(
                query=query, logstore=AliyunLogStore.workflow_node_execution_logstore
            )

            if results and len(results) > 0:
                return _dict_to_workflow_node_execution_model(results[0])

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

        Uses finished_at IS NOT NULL for deduplication optimization.
        Ordered by index DESC for trace visualization.
        """
        query = f"""
            * | SELECT *
            FROM {AliyunLogStore.workflow_node_execution_logstore}
            WHERE tenant_id='{tenant_id}'
              AND app_id='{app_id}'
              AND workflow_run_id='{workflow_run_id}'
              AND finished_at IS NOT NULL
            ORDER BY index DESC
        """

        try:
            results = self.logstore_client.execute_sql(
                query=query, logstore=AliyunLogStore.workflow_node_execution_logstore
            )

            # Convert results and filter out any None values
            models = []
            for row in results:
                try:
                    model = _dict_to_workflow_node_execution_model(row)
                    if model and model.id:  # Ensure model is valid
                        models.append(model)
                except Exception as e:
                    logger.warning("Failed to convert row to model: %s, row=%s", e, row)
                    continue

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

        Uses window function to get latest version.
        """
        tenant_filter = f"AND tenant_id='{tenant_id}'" if tenant_id else ""

        query = f"""
            * | SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) AS rn
                FROM {AliyunLogStore.workflow_node_execution_logstore}
                WHERE id='{execution_id}'
                  {tenant_filter}
            ) t
            WHERE rn = 1
        """

        try:
            results = self.logstore_client.execute_sql(
                query=query, logstore=AliyunLogStore.workflow_node_execution_logstore
            )

            if results and len(results) > 0:
                return _dict_to_workflow_node_execution_model(results[0])

            return None

        except Exception:
            logger.exception("Failed to get execution by ID from LogStore: execution_id=%s", execution_id)
            raise
