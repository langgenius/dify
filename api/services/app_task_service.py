"""Service for managing application task operations.

This service provides centralized logic for task control operations
like stopping tasks, handling both legacy Redis flag mechanism and
new GraphEngine command channel mechanism.
"""

import logging

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_redis import redis_client
from graphon.graph_engine.manager import GraphEngineManager
from models.model import AppMode

logger = logging.getLogger(__name__)
WF_STOP_DIAG_MARKER = "WF_STOP_DIAG_7B9C2F"


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
        2. New GraphEngine command channel (for workflow-based apps)

        Args:
            task_id: The task ID to stop
            invoke_from: The source of the invoke (e.g., DEBUGGER, WEB_APP, SERVICE_API)
            user_id: The user ID requesting the stop
            app_mode: The application mode (CHAT, AGENT_CHAT, ADVANCED_CHAT, WORKFLOW, etc.)

        Returns:
            None
        """
        logger.warning(
            "%s stop_task_enter task_id=%s invoke_from=%s user_id=%s app_mode=%s",
            WF_STOP_DIAG_MARKER,
            task_id,
            invoke_from,
            user_id,
            app_mode,
        )

        # Legacy mechanism: Set stop flag in Redis
        AppQueueManager.set_stop_flag(task_id, invoke_from, user_id)
        logger.warning("%s legacy_stop_flag_set task_id=%s", WF_STOP_DIAG_MARKER, task_id)

        # New mechanism: Send stop command via GraphEngine for workflow-based apps
        # This ensures proper workflow status recording in the persistence layer
        if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
            logger.warning("%s graph_engine_stop_command_send_start task_id=%s", WF_STOP_DIAG_MARKER, task_id)
            GraphEngineManager(redis_client).send_stop_command(task_id)
            logger.warning("%s graph_engine_stop_command_send_done task_id=%s", WF_STOP_DIAG_MARKER, task_id)
        else:
            logger.warning("%s graph_engine_stop_command_skipped task_id=%s app_mode=%s", WF_STOP_DIAG_MARKER, task_id, app_mode)
