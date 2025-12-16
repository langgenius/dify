"""
Celery-based implementation of the WorkflowExecutionRepository.

This implementation uses Celery tasks for asynchronous storage operations,
providing improved performance by offloading database operations to background workers.
"""

import logging
from typing import Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.entities.workflow_execution import WorkflowExecution
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from libs.helper import extract_tenant_id
from models import Account, CreatorUserRole, EndUser
from models.enums import WorkflowRunTriggeredFrom
from tasks.workflow_execution_tasks import (
    save_workflow_execution_task,
)

logger = logging.getLogger(__name__)


class CeleryWorkflowExecutionRepository(WorkflowExecutionRepository):
    """
    Celery-based implementation of the WorkflowExecutionRepository interface.

    This implementation provides asynchronous storage capabilities by using Celery tasks
    to handle database operations in background workers. This improves performance by
    reducing the blocking time for workflow execution storage operations.

    Key features:
    - Asynchronous save operations using Celery tasks
    - Support for multi-tenancy through tenant/app filtering
    - Automatic retry and error handling through Celery
    """

    _session_factory: sessionmaker
    _tenant_id: str
    _app_id: str | None
    _triggered_from: WorkflowRunTriggeredFrom | None
    _creator_user_id: str
    _creator_user_role: CreatorUserRole

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: str | None,
        triggered_from: WorkflowRunTriggeredFrom | None,
    ):
        """
        Initialize the repository with Celery task configuration and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for fallback operations
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)
        """
        # Store session factory for fallback operations
        if isinstance(session_factory, Engine):
            self._session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)
        elif isinstance(session_factory, sessionmaker):
            self._session_factory = session_factory
        else:
            raise ValueError(
                f"Invalid session_factory type {type(session_factory).__name__}; expected sessionmaker or Engine"
            )

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

        logger.info(
            "Initialized CeleryWorkflowExecutionRepository for tenant %s, app %s, triggered_from %s",
            self._tenant_id,
            self._app_id,
            self._triggered_from,
        )

    def save(self, execution: WorkflowExecution):
        """
        Save or update a WorkflowExecution instance asynchronously using Celery.

        This method queues the save operation as a Celery task and returns immediately,
        providing improved performance for high-throughput scenarios.

        Args:
            execution: The WorkflowExecution instance to save or update
        """
        try:
            # Serialize execution for Celery task
            execution_data = execution.model_dump()

            # Queue the save operation as a Celery task (fire and forget)
            save_workflow_execution_task.delay(  # type: ignore
                execution_data=execution_data,
                tenant_id=self._tenant_id,
                app_id=self._app_id or "",
                triggered_from=self._triggered_from.value if self._triggered_from else "",
                creator_user_id=self._creator_user_id,
                creator_user_role=self._creator_user_role.value,
            )

            logger.debug("Queued async save for workflow execution: %s", execution.id_)

        except Exception:
            logger.exception("Failed to queue save operation for execution %s", execution.id_)
            # In case of Celery failure, we could implement a fallback to synchronous save
            # For now, we'll re-raise the exception
            raise
