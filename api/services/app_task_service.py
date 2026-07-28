"""Service for managing application task operations.

This service provides centralized logic for task control operations
like stopping tasks, handling both legacy Redis flag mechanism and
new GraphEngine command channel mechanism.
"""

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_redis import redis_client
from graphon.graph_engine.manager import GraphEngineManager
from models.enums import CreatorUserRole
from models.model import AppMode
from services.workflow_handoff_cancellation_service import request_workflow_handoff_cancel_for_app


class AppTaskService:
    """Service for managing application task operations."""

    @staticmethod
    def stop_task(
        task_id: str,
        invoke_from: InvokeFrom,
        user_id: str,
        app_mode: AppMode,
        *,
        tenant_id: str,
        app_id: str,
        created_by_role: CreatorUserRole | None = None,
    ) -> None:
        """Stop a running task.

        This method handles stopping tasks using all applicable mechanisms:
        1. Legacy Redis flag mechanism (for backward compatibility)
        2. New GraphEngine command channel (for workflow-based apps)
        3. Durable handoff cancellation (when workflow handoff is enabled)

        Args:
            task_id: The task ID to stop
            invoke_from: The source of the invoke (e.g., DEBUGGER, WEB_APP, SERVICE_API)
            user_id: The user ID requesting the stop
            app_mode: The application mode (CHAT, AGENT_CHAT, ADVANCED_CHAT, WORKFLOW, etc.)
            tenant_id: The owning tenant used to scope durable handoff cancellation
            app_id: The owning app used to scope durable handoff cancellation
            created_by_role: Optional creator-role override for entry points,
                such as OpenAPI, whose caller type is independent of invoke_from.

        Returns:
            None
        """
        # Legacy mechanism: Set stop flag in Redis
        live_task_owned_by_user = AppQueueManager.set_stop_flag(task_id, invoke_from, user_id)

        # New mechanism: Send stop command via GraphEngine for workflow-based apps
        # This ensures proper workflow status recording in the persistence layer
        if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW, AppMode.RAG_PIPELINE):
            cancelled_handoffs = request_workflow_handoff_cancel_for_app(
                task_id,
                tenant_id=tenant_id,
                app_id=app_id,
                created_by_role=created_by_role
                or (CreatorUserRole.ACCOUNT if invoke_from.runs_as_account() else CreatorUserRole.END_USER),
                created_by=user_id,
            )
            # The graph command channel is keyed only by caller-provided task
            # id.  Send it only after either the legacy Redis owner record or
            # the durable creator-scoped handoff row proves ownership.
            if live_task_owned_by_user or cancelled_handoffs > 0:
                GraphEngineManager(redis_client).send_stop_command(task_id)
