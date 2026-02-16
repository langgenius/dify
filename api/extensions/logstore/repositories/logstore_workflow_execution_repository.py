import json
import logging
import os
import time
from typing import Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.workflow.entities import WorkflowExecution
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from extensions.logstore.aliyun_logstore import AliyunLogStore
from libs.helper import extract_tenant_id
from models import (
    Account,
    CreatorUserRole,
    EndUser,
)
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


class LogstoreWorkflowExecutionRepository(WorkflowExecutionRepository):
    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: str | None,
        triggered_from: WorkflowRunTriggeredFrom | None,
    ):
        """
        Initialize the repository with a SQLAlchemy sessionmaker or engine and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for creating sessions
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)
        """
        logger.debug(
            "LogstoreWorkflowExecutionRepository.__init__: app_id=%s, triggered_from=%s", app_id, triggered_from
        )
        # Initialize LogStore client
        # Note: Project/logstore/index initialization is done at app startup via ext_logstore
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
        self.sql_repository = SQLAlchemyWorkflowExecutionRepository(session_factory, user, app_id, triggered_from)

        # Control flag for dual-write (write to both LogStore and SQL database)
        # Set to True to enable dual-write for safe migration, False to use LogStore only
        self._enable_dual_write = os.environ.get("LOGSTORE_DUAL_WRITE_ENABLED", "false").lower() == "true"

        # Control flag for whether to write the `graph` field to LogStore.
        # If LOGSTORE_ENABLE_PUT_GRAPH_FIELD is "true", write the full `graph` field;
        # otherwise write an empty {} instead. Defaults to writing the `graph` field.
        self._enable_put_graph_field = os.environ.get("LOGSTORE_ENABLE_PUT_GRAPH_FIELD", "true").lower() == "true"

    def _to_logstore_model(self, domain_model: WorkflowExecution) -> list[tuple[str, str]]:
        """
        Convert a domain model to a logstore model (List[Tuple[str, str]]).

        Args:
            domain_model: The domain model to convert

        Returns:
            The logstore model as a list of key-value tuples
        """
        logger.debug(
            "_to_logstore_model: id=%s, workflow_id=%s, status=%s",
            domain_model.id_,
            domain_model.workflow_id,
            domain_model.status.value,
        )
        # Use values from constructor if provided
        if not self._triggered_from:
            raise ValueError("triggered_from is required in repository constructor")
        if not self._creator_user_id:
            raise ValueError("created_by is required in repository constructor")
        if not self._creator_user_role:
            raise ValueError("created_by_role is required in repository constructor")

        # Generate log_version as nanosecond timestamp for record versioning
        log_version = str(time.time_ns())

        # Use WorkflowRuntimeTypeConverter to handle complex types (Segment, File, etc.)
        json_converter = WorkflowRuntimeTypeConverter()

        logstore_model = [
            ("id", domain_model.id_),
            ("log_version", log_version),  # Add log_version field for append-only writes
            ("tenant_id", self._tenant_id),
            ("app_id", self._app_id or ""),
            ("workflow_id", domain_model.workflow_id),
            (
                "triggered_from",
                self._triggered_from.value if hasattr(self._triggered_from, "value") else str(self._triggered_from),
            ),
            ("type", domain_model.workflow_type.value),
            ("version", domain_model.workflow_version),
            (
                "graph",
                json.dumps(json_converter.to_json_encodable(domain_model.graph), ensure_ascii=False)
                if domain_model.graph and self._enable_put_graph_field
                else "{}",
            ),
            (
                "inputs",
                json.dumps(json_converter.to_json_encodable(domain_model.inputs), ensure_ascii=False)
                if domain_model.inputs
                else "{}",
            ),
            (
                "outputs",
                json.dumps(json_converter.to_json_encodable(domain_model.outputs), ensure_ascii=False)
                if domain_model.outputs
                else "{}",
            ),
            ("status", domain_model.status.value),
            ("error_message", domain_model.error_message or ""),
            ("total_tokens", str(domain_model.total_tokens)),
            ("total_steps", str(domain_model.total_steps)),
            ("exceptions_count", str(domain_model.exceptions_count)),
            (
                "created_by_role",
                self._creator_user_role.value
                if hasattr(self._creator_user_role, "value")
                else str(self._creator_user_role),
            ),
            ("created_by", self._creator_user_id),
            ("started_at", domain_model.started_at.isoformat() if domain_model.started_at else ""),
            ("finished_at", domain_model.finished_at.isoformat() if domain_model.finished_at else ""),
        ]

        return logstore_model

    def save(self, execution: WorkflowExecution) -> None:
        """
        Save or update a WorkflowExecution domain entity to the logstore.

        This method serves as a domain-to-logstore adapter that:
        1. Converts the domain entity to its logstore representation
        2. Persists the logstore model using Aliyun SLS
        3. Maintains proper multi-tenancy by including tenant context during conversion
        4. Optionally writes to SQL database for dual-write support (controlled by LOGSTORE_DUAL_WRITE_ENABLED)

        Args:
            execution: The WorkflowExecution domain entity to persist
        """
        logger.debug(
            "save: id=%s, workflow_id=%s, status=%s", execution.id_, execution.workflow_id, execution.status.value
        )
        try:
            logstore_model = self._to_logstore_model(execution)
            self.logstore_client.put_log(AliyunLogStore.workflow_execution_logstore, logstore_model)

            logger.debug("Saved workflow execution to logstore: id=%s", execution.id_)
        except Exception:
            logger.exception("Failed to save workflow execution to logstore: id=%s", execution.id_)
            raise

        # Dual-write to SQL database if enabled (for safe migration)
        if self._enable_dual_write:
            try:
                self.sql_repository.save(execution)
                logger.debug("Dual-write: saved workflow execution to SQL database: id=%s", execution.id_)
            except Exception:
                logger.exception("Failed to dual-write workflow execution to SQL database: id=%s", execution.id_)
                # Don't raise - LogStore write succeeded, SQL is just a backup
