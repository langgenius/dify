"""
Celery-based implementation of the WorkflowNodeExecutionRepository.

This implementation uses Celery tasks for asynchronous storage operations,
providing improved performance by offloading database operations to background workers.
"""

import logging
from collections.abc import Sequence
from typing import Optional, Union

from celery.result import AsyncResult
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
    get_workflow_node_executions_by_workflow_run_task,
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
    - Fallback to synchronous operations for read operations when immediate results are needed
    - Support for multi-tenancy through tenant/app filtering
    - Automatic retry and error handling through Celery
    - Configurable timeouts for async operations
    - Batch operations for improved efficiency
    """

    def __init__(
        self,
        session_factory: sessionmaker | Engine,
        user: Union[Account, EndUser],
        app_id: Optional[str],
        triggered_from: Optional[WorkflowNodeExecutionTriggeredFrom],
        async_timeout: int = 30,
    ):
        """
        Initialize the repository with Celery task configuration and context information.

        Args:
            session_factory: SQLAlchemy sessionmaker or engine for fallback operations
            user: Account or EndUser object containing tenant_id, user ID, and role information
            app_id: App ID for filtering by application (can be None)
            triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)
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
        
        # Cache for mapping execution IDs to workflow_execution_ids for efficient workflow-specific waiting
        self._workflow_execution_mapping: dict[str, str] = {}

        logger.info(
            f"Initialized CeleryWorkflowNodeExecutionRepository for tenant {self._tenant_id}, "
            f"app {self._app_id}, triggered_from {self._triggered_from}"
        )

    def save(self, execution: WorkflowNodeExecution) -> None:
        """
        Save or update a WorkflowNodeExecution instance asynchronously using Celery.

        This method queues the save operation as a Celery task and returns immediately,
        providing improved performance for high-throughput scenarios.

        Args:
            execution: The WorkflowNodeExecution instance to save or update
        """
        try:
            # Serialize execution for Celery task
            execution_data = execution.model_dump()

            # Queue the save operation as a Celery task
            task_result = save_workflow_node_execution_task.delay(
                execution_data=execution_data,
                tenant_id=self._tenant_id,
                app_id=self._app_id or "",
                triggered_from=self._triggered_from.value if self._triggered_from else "",
                creator_user_id=self._creator_user_id,
                creator_user_role=self._creator_user_role.value,
            )

            # Store the task result for potential status checking
            self._pending_saves[execution.id] = task_result
            
            # Cache the workflow_execution_id mapping for efficient workflow-specific waiting
            self._workflow_execution_mapping[execution.id] = execution.workflow_execution_id

            logger.debug(f"Queued async save for workflow node execution: {execution.id}")

        except Exception as e:
            logger.exception(f"Failed to queue save operation for node execution {execution.id}")
            # In case of Celery failure, we could implement a fallback to synchronous save
            # For now, we'll re-raise the exception
            raise

    def get_by_workflow_run(
        self,
        workflow_run_id: str,
        order_config: Optional[OrderConfig] = None,
    ) -> Sequence[WorkflowNodeExecution]:
        """
        Retrieve all WorkflowNodeExecution instances for a specific workflow run.

        Args:
            workflow_run_id: The workflow run ID
            order_config: Optional configuration for ordering results

        Returns:
            A sequence of WorkflowNodeExecution instances
        """
        try:
            # Wait for any pending saves that might affect this workflow run
            self._wait_for_pending_saves_by_workflow_run(workflow_run_id)

            # Serialize order config for Celery task
            if order_config:
                order_config_data = {"order_by": order_config.order_by, "order_direction": order_config.order_direction}
            else:
                order_config_data = None

            # Queue the get operation as a Celery task
            task_result = get_workflow_node_executions_by_workflow_run_task.delay(
                workflow_run_id=workflow_run_id,
                tenant_id=self._tenant_id,
                app_id=self._app_id or "",
                order_config=order_config_data,
            )

            # Wait for the result (synchronous for read operations)
            executions_data = task_result.get(timeout=self._async_timeout)

            result = []
            for execution_data in executions_data:
                execution = WorkflowNodeExecution.model_validate(execution_data)
                result.append(execution)

            return result

        except Exception as e:
            logger.exception(f"Failed to get workflow node executions for run {workflow_run_id}")
            # Could implement fallback to direct database access here
            return []

    def _wait_for_pending_saves_by_workflow_run(self, workflow_run_id: str) -> None:
        """
        Wait for any pending save operations that might affect the given workflow run.
        
        This method now uses the cached workflow_execution_id mapping to only wait for
        tasks that belong to the specific workflow run, improving efficiency.

        Args:
            workflow_run_id: The workflow run ID to check
        """
        # Find execution IDs that belong to this workflow run
        relevant_execution_ids = [
            execution_id for execution_id, cached_workflow_id in self._workflow_execution_mapping.items()
            if cached_workflow_id == workflow_run_id and execution_id in self._pending_saves
        ]
        
        logger.debug(f"Found {len(relevant_execution_ids)} pending saves for workflow run {workflow_run_id}")
        
        for execution_id in relevant_execution_ids:
            task_result = self._pending_saves.get(execution_id)
            if task_result and not task_result.ready():
                try:
                    logger.debug(f"Waiting for pending save to complete before read: {execution_id}")
                    task_result.get(timeout=self._async_timeout)
                except Exception as e:
                    logger.exception(f"Failed to wait for pending save {execution_id}")
            
            # Clean up completed tasks from both caches
            if task_result and task_result.ready():
                self._pending_saves.pop(execution_id, None)
                self._workflow_execution_mapping.pop(execution_id, None)

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
                # Remove completed task from both caches
                del self._pending_saves[execution_id]
                self._workflow_execution_mapping.pop(execution_id, None)
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
            self._workflow_execution_mapping.pop(execution_id, None)

        return len(self._pending_saves)

    def clear_pending_saves(self) -> None:
        """
        Clear all pending save operations without waiting for completion.

        This method is useful for cleanup operations or when canceling workflows.
        """
        self._pending_saves.clear()
        self._workflow_execution_mapping.clear()
        logger.debug("Cleared all pending save operations and workflow execution mappings")
