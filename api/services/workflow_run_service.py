import logging
import threading
from collections.abc import Sequence
from enum import StrEnum

from sqlalchemy import Engine, select
from sqlalchemy.orm import sessionmaker

import contexts
from core.workflow.entities.pause_reason import PauseReasonType
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import (
    Account,
    App,
    CreatorUserRole,
    EndUser,
    Message,
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
)
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory

logger = logging.getLogger(__name__)


class WorkflowResumeMode(StrEnum):
    """Mode for workflow resumption."""

    SIGNAL = "signal"
    CELERY = "celery"


class WorkflowRunService:
    _session_factory: sessionmaker
    _workflow_run_repo: APIWorkflowRunRepository

    def __init__(self, session_factory: Engine | sessionmaker | None = None):
        """Initialize WorkflowRunService with repository dependencies."""
        if session_factory is None:
            session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        elif isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)

        self._session_factory = session_factory
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            self._session_factory
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)

    def get_paginate_advanced_chat_workflow_runs(
        self, app_model: App, args: dict, triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING
    ) -> InfiniteScrollPagination:
        """
        Get advanced chat app workflow run list

        :param app_model: app model
        :param args: request args
        :param triggered_from: workflow run triggered from (default: DEBUGGING for preview runs)
        """

        class WorkflowWithMessage:
            message_id: str
            conversation_id: str

            def __init__(self, workflow_run: WorkflowRun):
                self._workflow_run = workflow_run

            def __getattr__(self, item):
                return getattr(self._workflow_run, item)

        pagination = self.get_paginate_workflow_runs(app_model, args, triggered_from)

        # Fetch all messages in one query to prevent N+1 queries
        workflow_run_ids = [wr.id for wr in pagination.data]
        messages = (
            db.session.query(Message).where(Message.workflow_run_id.in_(workflow_run_ids)).all()
            if workflow_run_ids
            else []
        )
        # Create a mapping from workflow_run_id to message
        message_map = {msg.workflow_run_id: msg for msg in messages}

        with_message_workflow_runs = []
        for workflow_run in pagination.data:
            # Use pre-fetched message from map instead of querying each time
            with_message_workflow_run = WorkflowWithMessage(workflow_run=workflow_run)
            message = message_map.get(workflow_run.id)
            if message:
                with_message_workflow_run.message_id = message.id
                with_message_workflow_run.conversation_id = message.conversation_id

            with_message_workflow_runs.append(with_message_workflow_run)

        pagination.data = with_message_workflow_runs
        return pagination

    def get_paginate_workflow_runs(
        self, app_model: App, args: dict, triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING
    ) -> InfiniteScrollPagination:
        """
        Get workflow run list

        :param app_model: app model
        :param args: request args
        :param triggered_from: workflow run triggered from (default: DEBUGGING)
        """
        limit = int(args.get("limit", 20))
        last_id = args.get("last_id")
        status = args.get("status")

        return self._workflow_run_repo.get_paginated_workflow_runs(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=triggered_from,
            limit=limit,
            last_id=last_id,
            status=status,
        )

    def get_workflow_run(self, app_model: App, run_id: str) -> WorkflowRun | None:
        """
        Get workflow run detail

        :param app_model: app model
        :param run_id: workflow run id
        """
        return self._workflow_run_repo.get_workflow_run_by_id(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            run_id=run_id,
        )

    def get_workflow_runs_count(
        self,
        app_model: App,
        status: str | None = None,
        time_range: str | None = None,
        triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    ) -> dict[str, int]:
        """
        Get workflow runs count statistics

        :param app_model: app model
        :param status: optional status filter
        :param time_range: optional time range filter (e.g., "7d", "4h", "30m", "30s")
        :param triggered_from: workflow run triggered from (default: DEBUGGING)
        :return: dict with total and status counts
        """
        return self._workflow_run_repo.get_workflow_runs_count(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=triggered_from,
            status=status,
            time_range=time_range,
        )

    def get_workflow_run_node_executions(
        self,
        app_model: App,
        run_id: str,
        user: Account | EndUser,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get workflow run node execution list
        """
        workflow_run = self.get_workflow_run(app_model, run_id)

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        if not workflow_run:
            return []

        # Get tenant_id from user
        tenant_id = user.tenant_id if isinstance(user, EndUser) else user.current_tenant_id
        if tenant_id is None:
            raise ValueError("User tenant_id cannot be None")

        return self._node_execution_service_repo.get_executions_by_workflow_run(
            tenant_id=tenant_id,
            app_id=app_model.id,
            workflow_run_id=run_id,
        )

    def resume_workflow(
        self,
        app_model: App,
        run_id: str,
        user_id: str,
        resume_reason: str,
        action: str,
        use_signal: bool = False,
        check_permission: bool = True,
    ) -> dict:
        """
        Resume a paused workflow

        :param app_model: app model
        :param run_id: workflow run id
        :param user_id: user id who is resuming the workflow
        :param resume_reason: reason for resuming
        :param action: action to take (approve or reject)
        :param use_signal: if True, send Redis signal for debugger mode SSE
        :param check_permission: if True, check user permission (default True for Console API, False for Service API)
        :return: dict with resume status
        """
        from core.workflow.enums import WorkflowExecutionStatus

        with self._session_factory() as session:
            # Get workflow run
            workflow_run = session.execute(
                select(WorkflowRun).where(
                    WorkflowRun.tenant_id == app_model.tenant_id,
                    WorkflowRun.app_id == app_model.id,
                    WorkflowRun.id == run_id,
                )
            ).scalar_one_or_none()

            if not workflow_run:
                raise ValueError("Workflow run not found")

            if workflow_run.status != WorkflowExecutionStatus.PAUSED.value:
                raise ValueError("Workflow is not in paused state")

            # Permission check: only for Console API
            # Service API uses API token which already validates app-level access
            if check_permission:
                if workflow_run.created_by_role == CreatorUserRole.END_USER.value:
                    # End users can only resume their own workflow runs
                    if workflow_run.created_by != user_id:
                        raise ValueError("Permission denied: you don't have permission to resume this workflow run")
                # Note: Console API users (created_by_role == ACCOUNT) can resume any workflow run
                # within their tenant. This is intentional for debugging and administrative purposes.

            # Get workflow pause record
            workflow_pause = session.execute(
                select(WorkflowPause).where(
                    WorkflowPause.workflow_run_id == run_id,
                    WorkflowPause.resumed_at.is_(None),
                )
            ).scalar_one_or_none()

            if not workflow_pause:
                raise ValueError("No active pause record found")

            # Get pause reason
            pause_reason = session.execute(
                select(WorkflowPauseReason).where(WorkflowPauseReason.pause_id == workflow_pause.id)
            ).scalar_one_or_none()

            if not pause_reason or pause_reason.type_ != PauseReasonType.HUMAN_INPUT_REQUIRED:
                raise ValueError("Pause reason is not human input required")

            # Get workflow model for resumption
            workflow = session.execute(
                select(Workflow).where(Workflow.id == workflow_pause.workflow_id)
            ).scalar_one_or_none()

            if not workflow:
                raise ValueError("Workflow not found")

            # Update workflow pause record
            workflow_pause.resumed_at = naive_utc_now()
            workflow_pause.resume_reason = resume_reason
            workflow_pause.resumed_by_user_id = user_id

            # Don't update workflow_run.status here - let the Celery task's
            # WorkflowResumePersistenceLayer handle it when execution actually starts.
            # This prevents race conditions where the status is set to RUNNING but
            # the workflow pauses again before the task completes.
            # The status remains PAUSED until the task actually starts executing.

            session.commit()

            # For debugger mode, send signal via in-memory channel instead of Celery task
            if use_signal:
                try:
                    from core.app.apps.workflow.resume_signal import ResumeSignal, resume_channel_registry

                    signal = ResumeSignal(
                        action=action,
                        reason=resume_reason,
                        user_id=user_id,
                        paused_node_id=pause_reason.node_id,
                    )
                    if resume_channel_registry.send_signal(run_id, signal):
                        logger.info("Resume signal sent for workflow run %s", run_id)
                        return {
                            "result": "success",
                            "workflow_run_id": run_id,
                            "status": WorkflowExecutionStatus.RUNNING.value,
                            "resumed_at": workflow_pause.resumed_at.isoformat(),
                            "resume_reason": resume_reason,
                            "mode": WorkflowResumeMode.SIGNAL.value,
                        }
                    else:
                        logger.warning(
                            "No active SSE channel for workflow run %s, falling back to Celery. "
                            "This can happen if the SSE connection was closed or the debugger was exited.",
                            run_id,
                        )
                except Exception:
                    logger.exception(
                        "Failed to send resume signal for workflow run %s, falling back to Celery task. "
                        "This indicates an unexpected error in the signal mechanism.",
                        run_id,
                    )
                    # Fall back to Celery task on any error

            # Trigger workflow resumption asynchronously via Celery
            try:
                from extensions.ext_storage import storage
                from tasks.workflow_execution_tasks import workflow_resume_task

                # Load state from storage
                state_json = storage.load(workflow_pause.state_object_key)
                if isinstance(state_json, bytes):
                    state_json = state_json.decode("utf-8")

                # Trigger async task
                workflow_resume_task.delay(
                    app_id=app_model.id,
                    workflow_id=workflow.id,
                    workflow_run_id=run_id,
                    state_json=state_json,
                    resume_reason=resume_reason,
                    user_id=user_id,
                    action=action,
                    paused_node_id=pause_reason.node_id,
                )

                logger.info("Workflow resume task queued for run %s", run_id)

            except Exception as e:
                logger.exception("Failed to queue workflow resume task for run %s", run_id)
                # Rollback workflow_pause changes since the task failed to queue
                workflow_pause.resumed_at = None
                workflow_pause.resume_reason = None
                workflow_pause.resumed_by_user_id = None
                session.commit()
                raise RuntimeError(f"Failed to queue workflow resume task: {str(e)}")

            return {
                "result": "success",
                "workflow_run_id": run_id,
                "status": WorkflowExecutionStatus.RUNNING.value,  # Will be RUNNING once task starts
                "resumed_at": workflow_pause.resumed_at.isoformat(),
                "resume_reason": resume_reason,
                "mode": WorkflowResumeMode.CELERY.value,
            }

    def get_pause_info(self, app_model: App, run_id: str) -> dict | None:
        """
        Get pause information for a workflow run

        :param app_model: app model
        :param run_id: workflow run id
        :return: dict with pause info or None
        """
        from core.workflow.enums import WorkflowExecutionStatus

        with self._session_factory() as session:
            # Use JOIN to fetch both workflow_pause and pause_reason in a single query
            result = session.execute(
                select(WorkflowPause, WorkflowPauseReason)
                .join(WorkflowPauseReason, WorkflowPauseReason.pause_id == WorkflowPause.id)
                .where(WorkflowPause.workflow_run_id == run_id)
            ).first()

            if not result:
                return None

            # result is a Row object, unpack it
            workflow_pause, pause_reason = result

            # Use enum constant for status values
            pause_status = (
                WorkflowExecutionStatus.SUCCEEDED.value
                if workflow_pause.resumed_at
                else WorkflowExecutionStatus.PAUSED.value
            )

            return {
                "status": pause_status,
                "pause_reason": {
                    "type": pause_reason.type_.value,
                    "node_id": pause_reason.node_id,
                    "pause_reason_text": pause_reason.message,
                },
                "paused_at": workflow_pause.created_at.isoformat(),
                "resumed_at": workflow_pause.resumed_at.isoformat() if workflow_pause.resumed_at else None,
                "resume_reason": workflow_pause.resume_reason,
            }
