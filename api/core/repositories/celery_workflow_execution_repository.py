"""
Celery-based implementation of the WorkflowExecutionRepository.

This implementation uses Celery tasks for asynchronous storage operations,
providing improved performance by offloading database operations to background workers.
"""

import logging
from typing import override

from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from core.repositories.factory import WorkflowExecutionRepository
from graphon.entities import WorkflowExecution
from models import Account, CreatorUserRole, EndUser, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom
from tasks.workflow_execution_tasks import (
    _create_workflow_run_from_execution,
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
        tenant_id: str,
        user: Account | EndUser,
        app_id: str | None,
        triggered_from: WorkflowRunTriggeredFrom | None,
    ):
        """
        Initialize the repository with Celery task configuration and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for fallback operations
            tenant_id: Tenant that owns the workflow execution
            user: Account or EndUser used for creator attribution
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)
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

        logger.info(
            "Initialized CeleryWorkflowExecutionRepository for tenant %s, app %s, triggered_from %s",
            self._tenant_id,
            self._app_id,
            self._triggered_from,
        )

    @override
    def save(self, execution: WorkflowExecution):
        """
        Save or update a WorkflowExecution instance using Celery.

        The initial WorkflowRun row is created synchronously so downstream paths
        that read it directly, such as pause persistence, can rely on its
        existence. Later updates are queued as Celery tasks to preserve the
        asynchronous storage behavior.

        Args:
            execution: The WorkflowExecution instance to save or update
        """
        try:
            if self._ensure_workflow_run_exists(execution):
                logger.debug("Synchronously created workflow execution: %s", execution.id_)
                return

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

    def _ensure_workflow_run_exists(self, execution: WorkflowExecution) -> bool:
        """
        Create the WorkflowRun row synchronously if it does not already exist.

        Returns True when this call created the row. Returns False when the row
        already exists and the caller should enqueue an asynchronous update.
        """
        if not self._triggered_from:
            raise ValueError("triggered_from is required in repository constructor")
        if not self._creator_user_id:
            raise ValueError("created_by is required in repository constructor")
        if not self._creator_user_role:
            raise ValueError("created_by_role is required in repository constructor")

        with self._session_factory() as session:
            existing_run = session.get(WorkflowRun, execution.id_)
            if existing_run:
                if existing_run.tenant_id != self._tenant_id:
                    raise ValueError("Unauthorized access to workflow run")
                return False

            workflow_run = _create_workflow_run_from_execution(
                execution=execution,
                tenant_id=self._tenant_id,
                app_id=self._app_id or "",
                triggered_from=self._triggered_from,
                creator_user_id=self._creator_user_id,
                creator_user_role=self._creator_user_role,
            )
            session.add(workflow_run)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                existing_run = session.get(WorkflowRun, execution.id_)
                if existing_run is None:
                    raise
                if existing_run.tenant_id != self._tenant_id:
                    raise ValueError("Unauthorized access to workflow run")
                return False

        return True
