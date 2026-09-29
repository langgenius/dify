"""
Celery-based implementation of the WorkflowExecutionRepository.

Celery tasks persist log payloads asynchronously. Run identity and lifecycle
state are committed synchronously so pause transactions do not depend on delivery.
"""

import logging
from typing import override

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.app.workflow.persistence_ports import WorkflowExecutionRepository
from graphon.entities import WorkflowExecution
from models import Account, CreatorUserRole, EndUser
from models.enums import WorkflowRunTriggeredFrom
from repositories.workflow.execution_writer import SQLAlchemyWorkflowExecutionRepository
from tasks.workflow_execution_tasks import (
    save_workflow_execution_task,
)

logger = logging.getLogger(__name__)


class CeleryWorkflowExecutionRepository(WorkflowExecutionRepository):
    """
    Celery-based implementation of the WorkflowExecutionRepository interface.

    Background workers store log payloads while the caller commits the small
    control record required for pause/resume operations.

    Key features:
    - Asynchronous log payload saves using Celery tasks
    - Synchronous lifecycle state for pause/resume transactions
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
        self._control_repository = SQLAlchemyWorkflowExecutionRepository(
            session_factory=self._session_factory,
            tenant_id=tenant_id,
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
        )

        logger.info(
            "Initialized CeleryWorkflowExecutionRepository for tenant %s, app %s, triggered_from %s",
            self._tenant_id,
            self._app_id,
            self._triggered_from,
        )

    @override
    def save(self, execution: WorkflowExecution):
        """
        Save or update a WorkflowExecution instance asynchronously using Celery.

        Control state is persisted before returning so pause transactions never
        wait for broker delivery. Log payloads are saved by the queued task.

        Args:
            execution: The WorkflowExecution instance to save or update
        """
        self._control_repository.save_control(execution)
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
