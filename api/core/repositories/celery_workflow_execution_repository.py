"""
Celery-based implementation of the WorkflowExecutionRepository.

This implementation uses Celery tasks for asynchronous storage operations,
providing improved performance by offloading database operations to background workers.
"""

import logging
from typing import Optional, Union

from celery.result import AsyncResult
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
    - Fallback to synchronous operations for read operations when immediate results are needed
    - Support for multi-tenancy through tenant/app filtering
    - Automatic retry and error handling through Celery
    - Configurable timeouts for async operations
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: Optional[str],
        triggered_from: Optional[WorkflowRunTriggeredFrom],
        async_timeout: int = 30,
    ):
        """
        Initialize the repository with Celery task configuration and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for fallback operations
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)
            async_timeout: Timeout in seconds for async operations (default: 30)
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

        # Async operation timeout
        self._async_timeout = async_timeout

        # Cache for pending async operations
        self._pending_saves: dict[str, AsyncResult] = {}

        logger.info(
            f"Initialized CeleryWorkflowExecutionRepository for tenant {self._tenant_id}, "
            f"app {self._app_id}, triggered_from {self._triggered_from}"
        )

    def save(self, execution: WorkflowExecution) -> None:
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

            # Queue the save operation as a Celery task
            task_result = save_workflow_execution_task.delay(
                execution_data=execution_data,
                tenant_id=self._tenant_id,
                app_id=self._app_id or "",
                triggered_from=self._triggered_from.value if self._triggered_from else "",
                creator_user_id=self._creator_user_id,
                creator_user_role=self._creator_user_role.value,
            )

            # Store the task result for potential status checking
            self._pending_saves[execution.id_] = task_result

            logger.debug(f"Queued async save for workflow execution: {execution.id_}")

        except Exception as e:
            logger.exception(f"Failed to queue save operation for execution {execution.id_}")
            # In case of Celery failure, we could implement a fallback to synchronous save
            # For now, we'll re-raise the exception
            raise

    def wait_for_pending_saves(self, timeout: Optional[int] = None) -> None:
        """
        Wait for all pending save operations to complete.

        This method is useful for ensuring data consistency when immediate
        persistence is required (e.g., during testing or critical operations).

        Args:
            timeout: Maximum time to wait for all operations (uses instance timeout if None)
        """
        wait_timeout = timeout or self._async_timeout

        for execution_id, task_result in list(self._pending_saves.items()):
            try:
                if not task_result.ready():
                    logger.debug(f"Waiting for save operation to complete: {execution_id}")
                    task_result.get(timeout=wait_timeout)
                # Remove completed task
                del self._pending_saves[execution_id]
            except Exception as e:
                logger.exception(f"Failed to wait for save operation {execution_id}")

    def get_pending_save_count(self) -> int:
        """
        Get the number of pending save operations.

        Returns:
            Number of save operations still in progress
        """
        # Clean up completed tasks
        completed_ids = []
        for execution_id, task_result in self._pending_saves.items():
            if task_result.ready():
                completed_ids.append(execution_id)

        for execution_id in completed_ids:
            del self._pending_saves[execution_id]

        return len(self._pending_saves)

    def clear_pending_saves(self) -> None:
        """
        Clear all pending save operations without waiting for completion.

        This method is useful for cleanup operations or when canceling workflows.
        """
        self._pending_saves.clear()
        logger.debug("Cleared all pending save operations")
