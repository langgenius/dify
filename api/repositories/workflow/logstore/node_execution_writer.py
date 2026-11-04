"""
LogStore implementation of the WorkflowNodeExecutionRepository.

This module provides a LogStore-based repository for WorkflowNodeExecution entities,
using Aliyun SLS LogStore with append-only writes and version control.
"""

import json
import logging
import time
from collections.abc import Sequence
from typing import override

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.workflow.persistence_ports import OrderConfig, WorkflowNodeExecutionRepository
from core.workflow.node_execution import WorkflowNodeExecution as DifyWorkflowNodeExecution
from extensions.logstore.aliyun_logstore import AliyunLogStore
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.workflow_type_encoder import WorkflowRuntimeTypeConverter
from models import (
    Account,
    CreatorUserRole,
    EndUser,
    WorkflowNodeExecutionTriggeredFrom,
)
from models.workflow import WorkflowNodeExecutionModel
from repositories.workflow.logstore.queries import latest_records, node_execution_page
from repositories.workflow.logstore.records import node_execution_from_log
from repositories.workflow.logstore.schema import WORKFLOW_NODE_EXECUTION_LOGSTORE
from repositories.workflow.node_execution_writer import SQLAlchemyWorkflowNodeExecutionRepository
from repositories.workflow.offload import WorkflowOffloadUploader
from repositories.workflow_run_control import apply_workflow_stop_to_node, get_stopped_workflow_run

logger = logging.getLogger(__name__)


class LogstoreWorkflowNodeExecutionWriter(WorkflowNodeExecutionRepository):
    """
    LogStore implementation of the WorkflowNodeExecutionRepository interface.

    This implementation uses Aliyun SLS LogStore with an append-only write strategy:
    - Each save() operation appends a new record with a version timestamp
    - Updates are simulated by writing new records with higher version numbers
    - Queries select the latest version before filtering execution status
    - Multi-tenancy is maintained through tenant_id filtering

    Version Strategy:
        version = time.time_ns()  # Nanosecond timestamp for unique ordering
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
        *,
        upload_file: WorkflowOffloadUploader,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            tenant_id: Tenant that owns the workflow node execution
            user: Account or EndUser used for creator attribution
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
        """
        logger.debug(
            "LogstoreWorkflowNodeExecutionWriter.__init__: app_id=%s, triggered_from=%s", app_id, triggered_from
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
        self._user = user
        self._upload_file = upload_file
        self._session_factory = (
            sessionmaker(bind=session_factory, expire_on_commit=False)
            if isinstance(session_factory, Engine)
            else session_factory
        )

        # Determine user role based on user type
        self._creator_user_role = CreatorUserRole.ACCOUNT if isinstance(user, Account) else CreatorUserRole.END_USER

        # Initialize SQL repository for dual-write support
        self.sql_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            tenant_id=tenant_id,
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
            upload_file=upload_file,
        )

        # Keep the migration switch on the typed application config so callers
        # and tests share the same validated source.
        self._enable_dual_write = dify_config.LOGSTORE_DUAL_WRITE_ENABLED

    @override
    def for_workflow_tool(self, app_id: str) -> "LogstoreWorkflowNodeExecutionWriter":
        return LogstoreWorkflowNodeExecutionWriter(
            session_factory=self._session_factory,
            tenant_id=self._tenant_id,
            user=self._user,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
            upload_file=self._upload_file,
        )

    def _to_logstore_model(self, domain_model: WorkflowNodeExecution, *, log_version: int) -> Sequence[tuple[str, str]]:
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

        version = str(log_version)

        json_converter = WorkflowRuntimeTypeConverter()
        triggered_from_workflow_id = triggered_from_node_execution_id = None
        if isinstance(domain_model, DifyWorkflowNodeExecution):
            triggered_from_workflow_id = domain_model.triggered_from_workflow_id
            triggered_from_node_execution_id = domain_model.triggered_from_node_execution_id

        logstore_model = [
            ("id", domain_model.id),
            ("log_version", version),  # Add log_version field for append-only writes
            ("tenant_id", self._tenant_id),
            ("app_id", self._app_id or ""),
            ("workflow_id", domain_model.workflow_id),
            ("triggered_from_workflow_id", triggered_from_workflow_id or ""),
            ("triggered_from_node_execution_id", triggered_from_node_execution_id or ""),
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
        execution, version = self._prepare_controlled_write(execution)
        try:
            logstore_model = self._to_logstore_model(execution, log_version=version)
            self.logstore_client.put_log(WORKFLOW_NODE_EXECUTION_LOGSTORE, logstore_model)

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

    def _prepare_controlled_write(self, execution: WorkflowNodeExecution) -> tuple[WorkflowNodeExecution, int]:
        """Project durable cancellation onto a snapshot while preserving LogStore ordering."""
        version = time.time_ns()
        if execution.status in (
            WorkflowNodeExecutionStatus.RUNNING,
            WorkflowNodeExecutionStatus.PAUSED,
            WorkflowNodeExecutionStatus.RETRY,
        ):
            execution = execution.model_copy()
            with self._session_factory() as session:
                apply_workflow_stop_to_node(
                    execution,
                    get_stopped_workflow_run(
                        session,
                        tenant_id=self._tenant_id,
                        workflow_run_id=execution.workflow_execution_id,
                    ),
                )
        return execution, version

    @override
    def save_many(self, executions: Sequence[WorkflowNodeExecution]) -> None:
        """Append exact records and batch the optional SQL backup."""
        if not executions:
            return
        controlled_executions = []
        for execution in executions:
            execution, version = self._prepare_controlled_write(execution)
            controlled_executions.append(execution)
            self.logstore_client.put_log(
                WORKFLOW_NODE_EXECUTION_LOGSTORE,
                self._to_logstore_model(execution, log_version=version),
            )
        if self._enable_dual_write:
            try:
                self.sql_repository.save_many(controlled_executions)
            except Exception:
                logger.exception("Failed to dual-write workflow node execution batch: %s", [e.id for e in executions])

    @override
    def save_synchronously(self, execution: WorkflowNodeExecution) -> None:
        """Create the SQL caller row required by Agent v2 participant ownership."""

        self.sql_repository.save_synchronously(execution)

    @override
    def save_execution_data(self, execution: WorkflowNodeExecution) -> None:
        """Append the supplied execution snapshot, including updated data fields."""
        execution, version = self._prepare_controlled_write(execution)
        self.logstore_client.put_log(
            WORKFLOW_NODE_EXECUTION_LOGSTORE,
            self._to_logstore_model(execution, log_version=version),
        )

        # Dual-write to SQL database if enabled (for safe migration)
        if self._enable_dual_write:
            try:
                self.sql_repository.save_execution_data(execution)
                logger.debug("Dual-write: saved node execution data to SQL database: id=%s", execution.id)
            except Exception:
                logger.exception("Failed to dual-write node execution data to SQL database: id=%s", execution.id)
                # Don't raise - LogStore write succeeded, SQL is just a backup

    @override
    def get_by_workflow_execution(
        self,
        workflow_execution_id: str,
        order_config: OrderConfig | None = None,
        *,
        include_paused: bool = False,
    ) -> Sequence[WorkflowNodeExecution]:
        owner = {
            "tenant_id": self._tenant_id,
            "workflow_run_id": workflow_execution_id,
            "triggered_from": WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        }
        if self._app_id:
            owner["app_id"] = self._app_id
        current = latest_records(WORKFLOW_NODE_EXECUTION_LOGSTORE, owner)
        order = []
        if order_config:
            direction = "DESC" if order_config.order_direction == "desc" else "ASC"
            for field in order_config.order_by:
                if field in WorkflowNodeExecutionModel.__table__.columns:
                    order.append(f'"{field}" {direction}')
        order.append("id ASC")
        executions = []
        page_size = 1000
        while True:
            rows = self.logstore_client.execute_sql(
                sql=node_execution_page(
                    current,
                    order_by=order,
                    include_paused=include_paused,
                    offset=len(executions),
                    count=page_size,
                ),
                logstore=WORKFLOW_NODE_EXECUTION_LOGSTORE,
            )
            executions.extend(node_execution_from_log(row) for row in rows)
            if len(rows) < page_size:
                with self._session_factory() as session:
                    stopped = get_stopped_workflow_run(
                        session,
                        tenant_id=self._tenant_id,
                        workflow_run_id=workflow_execution_id,
                    )
                    for execution in executions:
                        apply_workflow_stop_to_node(execution, stopped)
                return executions
