"""
Celery writer for workflow node executions.

This implementation uses Celery tasks for asynchronous storage operations,
providing improved performance by offloading database operations to background workers.
"""

import logging
from typing import override

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_node_execution_query_repository import CeleryWorkflowNodeExecutionCache
from core.repositories.factory import WorkflowNodeExecutionWriter
from core.repositories.sqlalchemy_workflow_node_execution_write_repository import (
    SQLAlchemyWorkflowNodeExecutionWriteRepository,
)
from graphon.entities import WorkflowNodeExecution
from models import Account, CreatorUserRole, EndUser
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from services.file_upload_service import FileUploadService
from tasks.workflow_node_execution_tasks import (
    save_workflow_node_execution_task,
)

logger = logging.getLogger(__name__)


class CeleryWorkflowNodeExecutionWriteRepository(WorkflowNodeExecutionWriter):
    """
    Celery-based implementation of the WorkflowNodeExecutionWriter interface.

    This implementation provides asynchronous storage capabilities by using Celery tasks
    to handle database operations in background workers. This improves performance by
    reducing the blocking time for workflow node execution storage operations.

    Key features:
    - Asynchronous save operations using Celery tasks
    - Pending execution cache shared with the reader until Celery persists the writes
    - Support for multi-tenancy through tenant/app filtering
    - Automatic retry and error handling through Celery
    """

    _session_factory: sessionmaker[Session]
    _tenant_id: str
    _app_id: str | None
    _triggered_from: WorkflowNodeExecutionTriggeredFrom | None
    _creator_user_id: str
    _creator_user_role: CreatorUserRole
    _cache: CeleryWorkflowNodeExecutionCache
    _sql_repository: SQLAlchemyWorkflowNodeExecutionWriteRepository

    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
        *,
        file_uploads: FileUploadService,
        cache: CeleryWorkflowNodeExecutionCache,
    ) -> None:
        """
        Initialize the repository with Celery task configuration and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for fallback operations
            tenant_id: Tenant that owns the workflow node execution
            user: Account or EndUser used for creator attribution
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
            file_uploads: Upload service bound to the same database as this repository
            cache: Pending execution state shared with this run's reader
        """
        # Store session factory for fallback operations
        match session_factory:
            case Engine():
                self._session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)
            case sessionmaker():
                self._session_factory = session_factory
            case _:
                raise ValueError(
                    f"Invalid session_factory type {type(session_factory).__name__}; expected sessionmaker or Engine"
                )

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

        self._cache = cache
        self._sql_repository = SQLAlchemyWorkflowNodeExecutionWriteRepository(
            session_factory=self._session_factory,
            tenant_id=tenant_id,
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
            file_uploads=file_uploads,
        )

        logger.info(
            "Initialized CeleryWorkflowNodeExecutionWriteRepository for tenant %s, app %s, triggered_from %s",
            self._tenant_id,
            self._app_id,
            self._triggered_from,
        )

    @override
    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update a WorkflowNodeExecution instance to cache and asynchronously to database.

        This method stores the execution in cache immediately for fast reads and queues
        the save operation as a Celery task without tracking the task status.

        Args:
            execution: The WorkflowNodeExecution instance to save or update
        """
        try:
            # Store in cache immediately for fast reads
            self._cache.executions[execution.id] = execution

            # Update workflow execution mapping for efficient retrieval
            if execution.workflow_execution_id:
                if execution.workflow_execution_id not in self._cache.workflow_execution_mapping:
                    self._cache.workflow_execution_mapping[execution.workflow_execution_id] = []
                if execution.id not in self._cache.workflow_execution_mapping[execution.workflow_execution_id]:
                    self._cache.workflow_execution_mapping[execution.workflow_execution_id].append(execution.id)

            # Serialize execution for Celery task
            execution_data = execution.model_dump()

            # Queue the save operation as a Celery task (fire and forget)
            save_workflow_node_execution_task.delay(
                execution_data=execution_data,
                tenant_id=self._tenant_id,
                app_id=self._app_id or "",
                triggered_from=self._triggered_from.value if self._triggered_from else "",
                creator_user_id=self._creator_user_id,
                creator_user_role=self._creator_user_role.value,
            )

            logger.debug("Cached and queued async save for workflow node execution: %s", execution.id)

        except Exception:
            logger.exception("Failed to cache or queue save operation for node execution %s", execution.id)
            # In case of Celery failure, we could implement a fallback to synchronous save
            # For now, we'll re-raise the exception
            raise

    @override
    def save_synchronously(self, execution: WorkflowNodeExecution) -> None:
        """Create the Agent v2 caller row before runtime participant allocation."""

        self._sql_repository.save_synchronously(execution)
        self._cache.executions[execution.id] = execution
        if execution.workflow_execution_id:
            execution_ids = self._cache.workflow_execution_mapping.setdefault(execution.workflow_execution_id, [])
            if execution.id not in execution_ids:
                execution_ids.append(execution.id)

    @override
    def save_execution_data(self, execution: WorkflowNodeExecution) -> None:
        """The queued save already contains inputs, outputs, and process data."""
