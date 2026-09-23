"""Service for managing application task operations.

This service provides centralized logic for task control operations
like stopping tasks, handling both legacy Redis flag mechanism and
new Engine command channel mechanism.
"""

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.execution_coordinator import app_task_stop_flag_key, send_abort_command
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_redis import RedisClientWrapper
from models.model import AppMode


class AppTaskControlService:
    """Injected task control for entry points that already admit app access."""

    def __init__(self, *, redis_client: RedisClientWrapper) -> None:
        self._redis_client: RedisClientWrapper = redis_client

    def stop_workflow_task_no_user_check(self, *, task_id: str) -> None:
        """Send both cancellation signals after the caller has admitted the app.

        Preserve the legacy stop flag even if the GraphEngine command fails.
        Trial workflow stops do not consult the task's user ownership cache.
        """
        if task_id:
            self._redis_client.setex(app_task_stop_flag_key(task_id), 600, 1)
        send_abort_command(task_id, redis=self._redis_client)


class AppTaskService:
    """Service for managing application task operations."""

    @staticmethod
    def stop_task(
        task_id: str,
        invoke_from: InvokeFrom,
        user_id: str,
        app_mode: AppMode,
    ) -> None:
        """Stop a running task.

        This method handles stopping tasks using both mechanisms:
        1. Legacy Redis flag mechanism (for backward compatibility)
        2. New Engine command channel (for workflow-based apps)

        Args:
            task_id: The task ID to stop
            invoke_from: The source of the invoke (e.g., DEBUGGER, WEB_APP, SERVICE_API)
            user_id: The user ID requesting the stop
            app_mode: The application mode (CHAT, AGENT_CHAT, ADVANCED_CHAT, WORKFLOW, etc.)

        Returns:
            None
        """
        # Legacy mechanism: Set stop flag in Redis
        AppQueueManager.set_stop_flag(task_id, invoke_from, user_id)

        # New mechanism: Send stop command via Engine for workflow-based apps
        # This ensures proper workflow status recording in the persistence layer
        if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
            send_abort_command(task_id)
