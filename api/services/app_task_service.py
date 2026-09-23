"""Service for managing application task operations.

This service provides centralized logic for task control operations
like stopping tasks, handling both legacy Redis flag mechanism and
new GraphEngine command channel mechanism.
"""

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.execution_coordinator import set_app_task_stop_flag
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_redis import RedisClientWrapper, redis_client
from graphon.graph_engine.manager import GraphEngineManager
from models.model import AppMode


class AppTaskControlService:
    """Service for managing application task operations."""

    def __init__(self, *, redis_client: RedisClientWrapper) -> None:
        self._redis_client: RedisClientWrapper = redis_client

    def stop_task(
        self,
        task_id: str,
        invoke_from: InvokeFrom,
        user_id: str,
        app_mode: AppMode,
    ) -> None:
        """Stop a running task.

        This method handles stopping tasks using both mechanisms:
        1. Legacy Redis flag mechanism (for backward compatibility)
        2. New GraphEngine command channel (for workflow-based apps)

        Args:
            task_id: The task ID to stop
            invoke_from: The source of the invoke (e.g., DEBUGGER, WEB_APP, SERVICE_API)
            user_id: The user ID requesting the stop
            app_mode: The application mode (CHAT, AGENT_CHAT, ADVANCED_CHAT, WORKFLOW, etc.)

        Returns:
            None
        """
        # Legacy mechanism: Set stop flag in Redis
        AppQueueManager.set_stop_flag(task_id, invoke_from, user_id, redis=self._redis_client)

        # New mechanism: Send stop command via GraphEngine for workflow-based apps
        # This ensures proper workflow status recording in the persistence layer
        if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
            GraphEngineManager(self._redis_client).send_stop_command(task_id)

    def stop_workflow_task_no_user_check(self, *, task_id: str) -> None:
        """Stop a workflow after app admission, without consulting the user ownership cache.

        Keep the legacy stop flag before the GraphEngine command, including when
        the latter fails. Callers must authorize access to the workflow app first.
        """
        set_app_task_stop_flag(task_id, redis=self._redis_client)
        GraphEngineManager(self._redis_client).send_stop_command(task_id)


class AppTaskService:
    """Compatibility entry point for callers outside ApplicationServices."""

    @staticmethod
    def stop_task(
        task_id: str,
        invoke_from: InvokeFrom,
        user_id: str,
        app_mode: AppMode,
    ) -> None:
        AppTaskControlService(redis_client=redis_client).stop_task(
            task_id=task_id,
            invoke_from=invoke_from,
            user_id=user_id,
            app_mode=app_mode,
        )
