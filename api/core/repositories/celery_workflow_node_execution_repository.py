"""
Celery-based implementation of the WorkflowNodeExecutionRepository.

This implementation uses Celery tasks for asynchronous storage operations,
providing improved performance by offloading database operations to background workers.
"""

import logging
from collections.abc import Sequence
from typing import Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.repositories.workflow_node_execution_repository import (
    OrderConfig,
    WorkflowNodeExecutionRepository,
)
from libs.helper import extract_tenant_id
from models import Account, CreatorUserRole, EndUser
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from tasks.workflow_node_execution_tasks import (
    save_workflow_node_execution_task,
)

logger = logging.getLogger(__name__)


class CeleryWorkflowNodeExecutionRepository(WorkflowNodeExecutionRepository):
    """
    Celery-based implementation of the WorkflowNodeExecutionRepository interface.

    This implementation provides asynchronous storage capabilities by using Celery tasks
    to handle database operations in background workers. This improves performance by
    reducing the blocking time for workflow node execution storage operations.

    Key features:
    - Asynchronous save operations using Celery tasks
    - In-memory cache for immediate reads
    - Support for multi-tenancy through tenant/app filtering
    - Automatic retry and error handling through Celery
    """

    _session_factory: sessionmaker
    _tenant_id: str
    _app_id: str | None
    _triggered_from: WorkflowNodeExecutionTriggeredFrom | None
    _creator_user_id: str
    _creator_user_role: CreatorUserRole
    _execution_cache: dict[str, WorkflowNodeExecution]
    _workflow_execution_mapping: dict[str, list[str]]

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: str | None,
        triggered_from: WorkflowNodeExecutionTriggeredFrom | None,
    ):
        """
        Initialize the repository with Celery task configuration and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for fallback operations
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
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

        # In-memory cache for workflow node executions
        self._execution_cache = {}

        # Cache for mapping workflow_execution_ids to execution IDs for efficient retrieval
        self._workflow_execution_mapping = {}

        logger.info(
            "Initialized CeleryWorkflowNodeExecutionRepository for tenant %s, app %s, triggered_from %s",
            self._tenant_id,
            self._app_id,
            self._triggered_from,
        )

    def save(self, execution: WorkflowNodeExecution):
        """
        Save or update a WorkflowNodeExecution instance to cache and asynchronously to database.

        This method stores the execution in cache immediately for fast reads and queues
        the save operation as a Celery task without tracking the task status.

        Args:
            execution: The WorkflowNodeExecution instance to save or update
        """
        try:
            # Store in cache immediately for fast reads
            self._execution_cache[execution.id] = execution

            # Update workflow execution mapping for efficient retrieval
            if execution.workflow_execution_id:
                if execution.workflow_execution_id not in self._workflow_execution_mapping:
                    self._workflow_execution_mapping[execution.workflow_execution_id] = []
                if execution.id not in self._workflow_execution_mapping[execution.workflow_execution_id]:
                    self._workflow_execution_mapping[execution.workflow_execution_id].append(execution.id)

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

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: OrderConfig | None = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all WorkflowNodeExecution instances for a specific workflow run from cache.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results

        Returns:
            A sequence of WorkflowNodeExecution instances
        """
        try:
            # Get execution IDs for this workflow run from cache
            execution_ids = self._workflow_execution_mapping.get(workflow_run_id, [])

            # Retrieve executions from cache
            result = []
            for execution_id in execution_ids:
                if execution_id in self._execution_cache:
                    result.append(self._execution_cache[execution_id])

            # Apply ordering if specified
            if order_config and result:
                # Sort based on the order configuration
                reverse = order_config.order_direction == "desc"

                # Sort by multiple fields if specified
                for field_name in reversed(order_config.order_by):
                    result.sort(key=lambda x: getattr(x, field_name, 0), reverse=reverse)

            logger.debug("Retrieved %d workflow node executions for run %s from cache", len(result), workflow_run_id)
            return result

        except Exception:
            logger.exception("Failed to get workflow node executions for run %s from cache", workflow_run_id)
            return []
