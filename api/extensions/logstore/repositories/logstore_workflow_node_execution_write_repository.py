"""
LogStore implementation of the WorkflowNodeExecutionWriter.

This module writes WorkflowNodeExecution entities to LogStore,
using Aliyun SLS LogStore with append-only writes and version control.
"""

import json
import logging
import time
from collections.abc import Sequence
from typing import override

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.file.uploads import FileUploadWriter
from core.repositories import SQLAlchemyWorkflowNodeExecutionWriteRepository
from core.repositories.factory import WorkflowNodeExecutionWriter
from extensions.logstore.aliyun_logstore import AliyunLogStore
from graphon.entities import WorkflowNodeExecution
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowNodeExecutionTriggeredFrom,
)

logger = logging.getLogger(__name__)


class LogstoreWorkflowNodeExecutionWriteRepository(WorkflowNodeExecutionWriter):
    """
    LogStore implementation of the WorkflowNodeExecutionWriter interface.

    This implementation uses Aliyun SLS LogStore with an append-only write strategy:
    - Each save() operation appends a new record with a version timestamp
    - Updates are simulated by writing new records with higher version numbers
    - Every record carries its tenant and application ownership

    Version Strategy:
        version = time.time_ns()  # Nanosecond timestamp for unique ordering
    """

    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
        *,
        file_uploads: FileUploadWriter,
    ) -> None:
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            tenant_id: Tenant that owns the workflow node execution
            user: Account or EndUser used for creator attribution
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
            file_uploads: Upload service bound to the same database as this repository
        """
        logger.debug(
            "LogstoreWorkflowNodeExecutionWriteRepository.__init__: app_id=%s, triggered_from=%s",
            app_id,
            triggered_from,
        )
        # Initialize LogStore client
        self.logstore_client = AliyunLogStore()

        if not tenant_id:
            raise ValueError("tenant_id is required")
        self._tenant_id = tenant_id

        # Store app context
        self._app_id = app_id

        # Extract user context
        self._triggered_from = triggered_from
        self._creator_user_id = user.id

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

        # Initialize SQL repository for dual-write support
        self.sql_repository = SQLAlchemyWorkflowNodeExecutionWriteRepository(
            session_factory=session_factory,
            tenant_id=tenant_id,
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
            file_uploads=file_uploads,
        )

        # Keep the migration switch on the typed application config so callers
        # and tests share the same validated source.
        self._enable_dual_write = dify_config.LOGSTORE_DUAL_WRITE_ENABLED

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
            ("node_type", domain_model.node_type),
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

    @override
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

    @override
    def save_synchronously(self, execution: WorkflowNodeExecution) -> None:
        """Create the SQL caller row required by Agent v2 participant ownership."""

        self.sql_repository.save_synchronously(execution)

    @override
    def save_execution_data(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update the inputs, process_data, or outputs associated with a specific
        node_execution record.

        For LogStore implementation, this is a no-op for the LogStore write because save()
        already writes all fields including inputs, process_data, and outputs. The caller
        typically calls save() first to persist status/metadata, then calls save_execution_data()
        to persist data fields. Since LogStore writes complete records atomically, we don't
        need a separate write here to avoid duplicate records.

        However, if dual-write is enabled, we still need to call the SQL repository's
        save_execution_data() method to properly update the SQL database.

        Args:
            execution: The NodeExecution instance with data to save
        """
        logger.debug(
            "save_execution_data: no-op for LogStore (data already saved by save()): id=%s, node_execution_id=%s",
            execution.id,
            execution.node_execution_id,
        )
        # No-op for LogStore: save() already writes all fields including inputs, process_data, and outputs
        # Calling save() again would create a duplicate record in the append-only LogStore

        # Dual-write to SQL database if enabled (for safe migration)
        if self._enable_dual_write:
            try:
                self.sql_repository.save_execution_data(execution)
                logger.debug("Dual-write: saved node execution data to SQL database: id=%s", execution.id)
            except Exception:
                logger.exception("Failed to dual-write node execution data to SQL database: id=%s", execution.id)
                # Don't raise - LogStore write succeeded, SQL is just a backup
