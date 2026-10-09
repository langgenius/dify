"""Service for managing application task operations.

This service provides centralized logic for task control operations
like stopping tasks, handling both legacy Redis flag mechanism and
new Engine command channel mechanism.
"""

import json
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.execution_coordinator import send_abort_command, set_app_task_stop_flag
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import WorkflowFinishStreamResponse
from core.repositories.factory import DifyCoreRepositoryFactory
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper, redis_client
from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from libs.datetime_utils import to_utc_timestamp
from models import Account, EndUser, WorkflowRun
from models.enums import CreatorUserRole
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionModel
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    WorkflowTaskOwnerMismatchError,
)

logger = logging.getLogger(__name__)


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
        AppQueueManager.set_stop_flag(task_id, invoke_from, user_id, redis=self._redis_client)

        # New mechanism: Send stop command via Engine for workflow-based apps
        # This ensures proper workflow status recording in the persistence layer
        if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
            send_abort_command(task_id, redis=self._redis_client)

    def stop_workflow_task_no_user_check(self, *, task_id: str) -> None:
        """Stop a workflow after app admission, without consulting the user ownership cache.

        Keep the legacy stop flag before the Engine command, including when
        the latter fails. Callers must authorize access to the workflow app first.
        """
        set_app_task_stop_flag(task_id, redis=self._redis_client)
        send_abort_command(task_id, redis=self._redis_client)

    def stop_workflow_task(
        self,
        *,
        tenant_id: str,
        app_id: str,
        task_id: str,
        app_mode: AppMode,
        owner: tuple[CreatorUserRole, str] | None,
    ) -> bool:
        """Apply durable workflow admission while retaining this service's Redis transport."""
        return AppTaskService.stop_workflow_task(
            tenant_id=tenant_id,
            app_id=app_id,
            task_id=task_id,
            app_mode=app_mode,
            owner=owner,
            redis=self._redis_client,
        )


class AppTaskService:
    """Compatibility entry point for callers outside ApplicationServices."""

    @staticmethod
    def stop_workflow_task(
        *,
        tenant_id: str,
        app_id: str,
        task_id: str,
        app_mode: AppMode,
        owner: tuple[CreatorUserRole, str] | None,
        redis: RedisClientWrapper | None = None,
    ) -> bool:
        """Stop a persisted pause, or signal its currently executing attempt.

        A paused task has no engine consuming Redis commands. Its durable
        transition and form invalidation must complete before acknowledging stop.
        Omitted Redis uses the compatibility transport; injected callers supply theirs.
        """
        try:
            task_id = str(UUID(task_id))
        except ValueError as exc:
            raise ValueError("Invalid task ID: expected a UUID") from exc
        repository = DifyAPISQLAlchemyWorkflowRunRepository(sessionmaker(bind=db.engine))
        try:
            run = repository.stop_paused_workflow_task(tenant_id=tenant_id, app_id=app_id, task_id=task_id, owner=owner)
        except WorkflowTaskOwnerMismatchError:
            return False
        if run is not None and run.status == WorkflowExecutionStatus.RUNNING:
            # Resume has claimed the pause, but may not have opened its queue.
            # The repository has already checked the complete app/user owner.
            AppTaskControlService(
                redis_client=redis if redis is not None else redis_client
            ).stop_workflow_task_no_user_check(task_id=task_id)
            return True
        if run is None:
            return False

        AppTaskService._persist_stopped_history(run)

        # The paused engine cannot execute its terminal Workspace layer. Keep
        # run-owned Agent resources on the same retirement path as a live abort.
        from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
        from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

        try:
            workspace_ids = WorkflowAgentWorkspaceStore().retire_workflow_run(
                tenant_id=tenant_id, app_id=app_id, workflow_run_id=run.id
            )
            enqueue_agent_resource_collection(tenant_id=tenant_id, workspace_ids=workspace_ids)
        except Exception:
            logger.exception("Failed to retire stopped Workflow Agent Workspaces, workflow_run_id=%s", run.id)

        event = WorkflowFinishStreamResponse(
            task_id=task_id,
            workflow_run_id=run.id,
            data=WorkflowFinishStreamResponse.Data(
                id=run.id,
                workflow_id=run.workflow_id,
                status=run.status,
                outputs=run.outputs_dict,
                error=run.error,
                elapsed_time=run.elapsed_time,
                total_tokens=run.total_tokens,
                total_steps=run.total_steps,
                created_by={},
                created_at=int(to_utc_timestamp(run.created_at)),
                finished_at=int(to_utc_timestamp(run.finished_at)) if run.finished_at is not None else None,
                exceptions_count=run.exceptions_count,
                files=[],
            ),
        )
        topic = MessageBasedAppGenerator.get_response_topic(app_mode, run.id)
        topic.publish(json.dumps(event.model_dump(mode="json"), ensure_ascii=False).encode())
        return True

    @staticmethod
    def _persist_stopped_history(run: WorkflowRun) -> None:
        # The SQL stop transaction is already committed. Persist the terminal
        # history through the configured backend without holding its run lock.
        user = Account(name="", email="") if run.created_by_role == CreatorUserRole.ACCOUNT else EndUser()
        user.id = run.created_by
        repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
            session_factory=sessionmaker(bind=db.engine),
            tenant_id=run.tenant_id,
            user=user,
            app_id=run.app_id,
            triggered_from=run.triggered_from,
        )
        repository.save_synchronously(
            WorkflowExecution(
                id_=run.id,
                workflow_id=run.workflow_id,
                workflow_type=WorkflowType(run.type),
                workflow_version=run.version,
                graph=run.graph_dict,
                inputs=run.inputs_dict,
                outputs=run.outputs_dict,
                status=WorkflowExecutionStatus.STOPPED,
                error_message=run.error or "User requested stop",
                total_tokens=run.total_tokens,
                total_steps=run.total_steps,
                exceptions_count=run.exceptions_count,
                started_at=run.created_at,
                finished_at=run.finished_at,
            )
        )
        factory = sessionmaker(bind=db.engine)
        with factory() as session:
            scopes = session.execute(
                select(WorkflowNodeExecutionModel.app_id, WorkflowNodeExecutionModel.triggered_from)
                .where(
                    WorkflowNodeExecutionModel.tenant_id == run.tenant_id,
                    WorkflowNodeExecutionModel.workflow_run_id == run.id,
                    WorkflowNodeExecutionModel.status == WorkflowNodeExecutionStatus.FAILED,
                    WorkflowNodeExecutionModel.finished_at == run.finished_at,
                    WorkflowNodeExecutionModel.error == run.error,
                )
                .distinct()
            ).all()
        for app_id, triggered_from in scopes:
            source = SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=factory,
                tenant_id=run.tenant_id,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            stopped_nodes = [
                execution
                for execution in source.get_by_workflow_execution(run.id, include_paused=True)
                if execution.status == WorkflowNodeExecutionStatus.FAILED
                and execution.finished_at == run.finished_at
                and execution.error == run.error
            ]
            target = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=factory,
                tenant_id=run.tenant_id,
                user=user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            for execution in stopped_nodes:
                target.save(execution)

    @staticmethod
    def stop_task(
        task_id: str,
        invoke_from: InvokeFrom,
        user_id: str,
        app_mode: AppMode,
        *,
        tenant_id: str,
        app_id: str,
    ) -> None:
        if app_mode in (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW):
            role = CreatorUserRole.ACCOUNT if invoke_from.runs_as_account() else CreatorUserRole.END_USER
            AppTaskService.stop_workflow_task(
                tenant_id=tenant_id,
                app_id=app_id,
                task_id=task_id,
                app_mode=app_mode,
                owner=(role, user_id),
            )
            return
        AppTaskControlService(redis_client=redis_client).stop_task(
            task_id=task_id,
            invoke_from=invoke_from,
            user_id=user_id,
            app_mode=app_mode,
        )
