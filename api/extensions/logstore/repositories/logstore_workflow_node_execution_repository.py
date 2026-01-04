"""
LogStore implementation of the WorkflowNodeExecutionRepository.

This module provides a LogStore-based repository for WorkflowNodeExecution entities,
using Aliyun SLS LogStore with append-only writes and version control.
"""

import json
import logging
import os
import time
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.model_runtime.utils.encoders import jsonable_encoder
from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities import WorkflowNodeExecution
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.enums import NodeType
from core.workflow.repositories.workflow_node_execution_repository import OrderConfig, WorkflowNodeExecutionRepository
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from extensions.logstore.aliyun_logstore import AliyunLogStore
from libs.helper import extract_tenant_id
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowNodeExecutionTriggeredFrom,
)

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
    inputs = json.loads(data.get("inputs", "{}"))
    process_data = json.loads(data.get("process_data", "{}"))
    outputs = json.loads(data.get("outputs", "{}"))
    metadata = json.loads(data.get("execution_metadata", "{}"))

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
        index=int(data.get("index", 0)),
        predecessor_node_id=data.get("predecessor_node_id"),
        node_id=data.get("node_id", ""),
        node_type=NodeType(data.get("node_type", "start")),
        title=data.get("title", ""),
        inputs=inputs,
        process_data=process_data,
        outputs=outputs,
        status=status,
        error=data.get("error"),
        elapsed_time=float(data.get("elapsed_time", 0.0)),
        metadata=domain_metadata,
        created_at=created_at,
        finished_at=finished_at,
    )


class LogstoreWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository):
    """
    LogStore implementation of the WorkflowNodeExecutionRepository interface.

    This implementation uses Aliyun SLS LogStore with an append-only write strategy:
    - Each save() operation appends a new record with a version timestamp
    - Updates are simulated by writing new records with higher version numbers
    - Queries retrieve the latest version using finished_at IS NOT NULL filter
    - Multi-tenancy is maintained through tenant_id filtering

    Version Strategy:
        version = time.time_ns()  # Nanosecond timestamp for unique ordering
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
        """
        logger.debug(
            "LogstoreWorkflowNodeExecutionRepository.__init__: app_id=%s, triggered_from=%s", app_id, triggered_from
        )
        # Initialize LogStore client
        self.logstore_client = AliyunLogStore()

        # Extract tenant_id from user
        tenant_id = extract_tenant_id(user)
        if not tenant_id:
            raise ValueError("User must have a tenant_id or current_tenant_id")
        self._tenant_id = tenant_id

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._creator_user_id = user.id

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

        # Initialize SQL repository for dual-write support
        self.sql_repository = SQLAlchemyWorkflowNodeExecutionRepository(session_factory, user, app_id, triggered_from)

        # Control flag for dual-write (write to both LogStore and SQL database)
        # Set to True to enable dual-write for safe migration, False to use LogStore only
        self._enable_dual_write = os.environ.get("LOGSTORE_DUAL_WRITE_ENABLED", "true").lower() == "true"

    def _to_logstore_model(self, domain_model: WorkflowNodeExecution) -> Sequence[tuple[str, str]]:
        logger.debug(
            "_to_logstore_model: id=%s, node_id=%s, status=%s",
            domain_model.id,
            domain_model.node_id,
            domain_model.status.value,
        )
        if not self._triggered_from:
            raise ValueError("triggered_from is required in repository constructor")
        if not self._creator_user_id:
            raise ValueError("created_by is required in repository constructor")
        if not self._creator_user_role:
            raise ValueError("created_by_role is required in repository constructor")

        # Generate log_version as nanosecond timestamp for record versioning
        log_version = str(time.time_ns())

        json_converter = WorkflowRuntimeTypeConverter()

        logstore_model = [
            ("id", domain_model.id),
            ("log_version", log_version),  # Add log_version field for append-only writes
            ("tenant_id", self._tenant_id),
            ("app_id", self._app_id or ""),
            ("workflow_id", domain_model.workflow_id),
            (
                "triggered_from",
                self._triggered_from.value if hasattr(self._triggered_from, "value") else str(self._triggered_from),
            ),
            ("workflow_run_id", domain_model.workflow_execution_id or ""),
            ("index", str(domain_model.index)),
            ("predecessor_node_id", domain_model.predecessor_node_id or ""),
            ("node_execution_id", domain_model.node_execution_id or ""),
            ("node_id", domain_model.node_id),
            ("node_type", domain_model.node_type.value),
            ("title", domain_model.title),
            (
                "inputs",
                json.dumps(json_converter.to_json_encodable(domain_model.inputs), ensure_ascii=False)
                if domain_model.inputs
                else "{}",
            ),
            (
                "process_data",
                json.dumps(json_converter.to_json_encodable(domain_model.process_data), ensure_ascii=False)
                if domain_model.process_data
                else "{}",
            ),
            (
                "outputs",
                json.dumps(json_converter.to_json_encodable(domain_model.outputs), ensure_ascii=False)
                if domain_model.outputs
                else "{}",
            ),
            ("status", domain_model.status.value),
            ("error", domain_model.error or ""),
            ("elapsed_time", str(domain_model.elapsed_time)),
            (
                "execution_metadata",
                json.dumps(jsonable_encoder(domain_model.metadata), ensure_ascii=False)
                if domain_model.metadata
                else "{}",
            ),
            ("created_at", domain_model.created_at.isoformat() if domain_model.created_at else ""),
            ("created_by_role", self._creator_user_role.value),
            ("created_by", self._creator_user_id),
            ("finished_at", domain_model.finished_at.isoformat() if domain_model.finished_at else ""),
        ]

        return logstore_model

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update a NodeExecution domain entity to LogStore.

        This method serves as a domain-to-logstore adapter that:
        1. Converts the domain entity to its logstore representation
        2. Appends a new record with a log_version timestamp
        3. Maintains proper multi-tenancy by including tenant context during conversion
        4. Optionally writes to SQL database for dual-write support (controlled by LOGSTORE_DUAL_WRITE_ENABLED)

        Each save operation creates a new record. Updates are simulated by writing
        new records with higher log_version numbers.

        Args:
            execution: The NodeExecution domain entity to persist
        """
        logger.debug(
            "save: id=%s, node_execution_id=%s, status=%s",
            execution.id,
            execution.node_execution_id,
            execution.status.value,
        )
        try:
            logstore_model = self._to_logstore_model(execution)
            self.logstore_client.put_log(AliyunLogStore.workflow_node_execution_logstore, logstore_model)

            logger.debug(
                "Saved node execution to LogStore: id=%s, node_execution_id=%s, status=%s",
                execution.id,
                execution.node_execution_id,
                execution.status.value,
            )
        except Exception:
            logger.exception(
                "Failed to save node execution to LogStore: id=%s, node_execution_id=%s",
                execution.id,
                execution.node_execution_id,
            )
            raise

        # Dual-write to SQL database if enabled (for safe migration)
        if self._enable_dual_write:
            try:
                self.sql_repository.save(execution)
                logger.debug("Dual-write: saved node execution to SQL database: id=%s", execution.id)
            except Exception:
                logger.exception("Failed to dual-write node execution to SQL database: id=%s", execution.id)
                # Don't raise - LogStore write succeeded, SQL is just a backup

    def save_execution_data(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update the inputs, process_data, or outputs associated with a specific
        node_execution record.

        For LogStore implementation, this is similar to save() since we always write
        complete records. We append a new record with updated data fields.

        Args:
            execution: The NodeExecution instance with data to save
        """
        logger.debug("save_execution_data: id=%s, node_execution_id=%s", execution.id, execution.node_execution_id)
        # In LogStore, we simply write a new complete record with the data
        # The log_version timestamp will ensure this is treated as the latest version
        self.save(execution)

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all NodeExecution instances for a specific workflow run.
        Uses LogStore SQL query with finished_at IS NOT NULL filter for deduplication.
        This ensures we only get the final version of each node execution.
        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results
                order_config.order_by: List of fields to order by (e.g., ["index", "created_at"])
                order_config.order_direction: Direction to order ("asc" or "desc")

        Returns:
            A list of NodeExecution instances

        Note:
            This method filters by finished_at IS NOT NULL to avoid duplicates from
            version updates. For complete history including intermediate states,
            a different query strategy would be needed.
        """
        logger.debug("get_by_workflow_run: workflow_run_id=%s, order_config=%s", workflow_run_id, order_config)
        # Build SQL query with deduplication using finished_at IS NOT NULL
        # This optimization avoids window functions for common case where we only
        # want the final state of each node execution

        # Build ORDER BY clause
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

        sql = f"""
            SELECT *
            FROM {AliyunLogStore.workflow_node_execution_logstore}
            WHERE workflow_run_id='{workflow_run_id}'
              AND tenant_id='{self._tenant_id}'
              AND finished_at IS NOT NULL
        """

        if self._app_id:
            sql += f" AND app_id='{self._app_id}'"

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
            logger.exception("Failed to retrieve node executions from LogStore: workflow_run_id=%s", workflow_run_id)
            raise
