"""
Universal async workflow execution service.

This service provides a centralized entry point for triggering workflows asynchronously
with support for different subscription tiers, rate limiting, and execution tracking.
"""

import json
from datetime import UTC, datetime
from typing import Optional, Union

from celery.result import AsyncResult
from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account
from models.enums import CreatorUserRole
from models.model import App, EndUser
from models.workflow import Workflow, WorkflowTriggerLog, WorkflowTriggerStatus
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.errors.llm import InvokeRateLimitError
from services.workflow.entities import AsyncTriggerResponse, TriggerData, WorkflowTaskData
from services.workflow.queue_dispatcher import QueueDispatcherManager, QueuePriority
from services.workflow.rate_limiter import TenantDailyRateLimiter
from services.workflow_service import WorkflowService
from tasks.async_workflow_tasks import (
    execute_workflow_professional,
    execute_workflow_sandbox,
    execute_workflow_team,
)


class AsyncWorkflowService:
    """
    Universal entry point for async workflow execution - ALL METHODS ARE NON-BLOCKING

    This service handles:
    - Trigger data validation and processing
    - Queue routing based on subscription tier
    - Daily rate limiting with timezone support
    - Execution tracking and logging
    - Retry mechanisms for failed executions

    Important: All trigger methods return immediately after queuing tasks.
    Actual workflow execution happens asynchronously in background Celery workers.
    Use trigger log IDs to monitor execution status and results.
    """

    @classmethod
    def trigger_workflow_async(
        cls, session: Session, user: Union[Account, EndUser], trigger_data: TriggerData
    ) -> AsyncTriggerResponse:
        """
        Universal entry point for async workflow execution - THIS METHOD WILL NOT BLOCK

        Creates a trigger log and dispatches to appropriate queue based on subscription tier.
        The workflow execution happens asynchronously in the background via Celery workers.
        This method returns immediately after queuing the task, not after execution completion.

        Args:
            session: Database session to use for operations
            user: User (Account or EndUser) who initiated the workflow trigger
            trigger_data: Validated Pydantic model containing trigger information

        Returns:
            AsyncTriggerResponse with workflow_trigger_log_id, task_id, status="queued", and queue
            Note: The actual workflow execution status must be checked separately via workflow_trigger_log_id

        Raises:
            ValueError: If app or workflow not found
            InvokeRateLimitError: If daily rate limit exceeded

        Behavior:
            - Non-blocking: Returns immediately after queuing
            - Asynchronous: Actual execution happens in background Celery workers
            - Status tracking: Use workflow_trigger_log_id to monitor progress
            - Queue-based: Routes to different queues based on subscription tier
        """
        trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        dispatcher_manager = QueueDispatcherManager()
        workflow_service = WorkflowService()
        rate_limiter = TenantDailyRateLimiter(redis_client)

        # 1. Validate app exists
        app_model = session.scalar(select(App).where(App.id == trigger_data.app_id))
        if not app_model:
            raise ValueError(f"App not found: {trigger_data.app_id}")

        # 2. Get workflow
        workflow = cls._get_workflow(workflow_service, app_model, trigger_data.workflow_id)

        # 3. Get dispatcher based on tenant subscription
        dispatcher = dispatcher_manager.get_dispatcher(trigger_data.tenant_id)

        # 4. Get tenant owner timezone for rate limiting
        tenant_owner_tz = rate_limiter._get_tenant_owner_timezone(trigger_data.tenant_id)

        # 5. Determine user role and ID
        if isinstance(user, Account):
            created_by_role = CreatorUserRole.ACCOUNT
            created_by = user.id
        else:  # EndUser
            created_by_role = CreatorUserRole.END_USER
            created_by = user.id

        # 6. Create trigger log entry first (for tracking)
        trigger_log = WorkflowTriggerLog(
            tenant_id=trigger_data.tenant_id,
            app_id=trigger_data.app_id,
            workflow_id=workflow.id,
            root_node_id=trigger_data.root_node_id,
            trigger_type=trigger_data.trigger_type,
            trigger_data=trigger_data.model_dump_json(),
            inputs=json.dumps(dict(trigger_data.inputs)),
            status=WorkflowTriggerStatus.PENDING,
            queue_name=dispatcher.get_queue_name(),
            retry_count=0,
            created_by_role=created_by_role,
            created_by=created_by,
        )

        trigger_log = trigger_log_repo.create(trigger_log)
        session.commit()

        # 7. Check and consume daily quota
        if not dispatcher.consume_quota(trigger_data.tenant_id, tenant_owner_tz):
            # Update trigger log status
            trigger_log.status = WorkflowTriggerStatus.RATE_LIMITED
            trigger_log.error = f"Daily limit reached for {dispatcher.get_queue_name()}"
            trigger_log_repo.update(trigger_log)
            session.commit()

            remaining = rate_limiter.get_remaining_quota(
                trigger_data.tenant_id, dispatcher.get_daily_limit(), tenant_owner_tz
            )

            reset_time = rate_limiter.get_quota_reset_time(trigger_data.tenant_id, tenant_owner_tz)

            raise InvokeRateLimitError(
                f"Daily workflow execution limit reached. "
                f"Limit resets at {reset_time.strftime('%Y-%m-%d %H:%M:%S %Z')}. "
                f"Remaining quota: {remaining}"
            )

        # 8. Create task data
        queue_name = dispatcher.get_queue_name()

        task_data = WorkflowTaskData(workflow_trigger_log_id=trigger_log.id)

        # 9. Dispatch to appropriate queue
        task_data_dict = task_data.model_dump(mode="json")

        task: AsyncResult | None = None
        if queue_name == QueuePriority.PROFESSIONAL:
            task = execute_workflow_professional.delay(task_data_dict)  # type: ignore
        elif queue_name == QueuePriority.TEAM:
            task = execute_workflow_team.delay(task_data_dict)  # type: ignore
        else:  # SANDBOX
            task = execute_workflow_sandbox.delay(task_data_dict)  # type: ignore

        if not task:
            raise ValueError(f"Failed to queue task for queue: {queue_name}")

        # 10. Update trigger log with task info
        trigger_log.status = WorkflowTriggerStatus.QUEUED
        trigger_log.celery_task_id = task.id
        trigger_log.triggered_at = datetime.now(UTC)
        trigger_log_repo.update(trigger_log)
        session.commit()

        return AsyncTriggerResponse(
            workflow_trigger_log_id=trigger_log.id,
            task_id=task.id,  # type: ignore
            status="queued",
            queue=queue_name,
        )

    @classmethod
    def reinvoke_trigger(
        cls, session: Session, user: Union[Account, EndUser], workflow_trigger_log_id: str
    ) -> AsyncTriggerResponse:
        """
        Re-invoke a previously failed or rate-limited trigger - THIS METHOD WILL NOT BLOCK

        Updates the existing trigger log to retry status and creates a new async execution.
        Returns immediately after queuing the retry, not after execution completion.

        Args:
            session: Database session to use for operations
            user: User (Account or EndUser) who initiated the retry
            workflow_trigger_log_id: ID of the trigger log to re-invoke

        Returns:
            AsyncTriggerResponse with new execution information (status="queued")
            Note: This creates a new trigger log entry for the retry attempt

        Raises:
            ValueError: If trigger log not found

        Behavior:
            - Non-blocking: Returns immediately after queuing retry
            - Creates new trigger log: Original log marked as retrying, new log for execution
            - Preserves original trigger data: Uses same inputs and configuration
        """
        trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)

        trigger_log = trigger_log_repo.get_by_id(workflow_trigger_log_id)

        if not trigger_log:
            raise ValueError(f"Trigger log not found: {workflow_trigger_log_id}")

        # Reconstruct trigger data from log
        trigger_data = TriggerData.model_validate_json(trigger_log.trigger_data)

        # Reset log for retry
        trigger_log.status = WorkflowTriggerStatus.RETRYING
        trigger_log.retry_count += 1
        trigger_log.error = None
        trigger_log.triggered_at = datetime.now(UTC)
        trigger_log_repo.update(trigger_log)
        session.commit()

        # Re-trigger workflow (this will create a new trigger log)
        return cls.trigger_workflow_async(session, user, trigger_data)

    @classmethod
    def get_trigger_log(cls, workflow_trigger_log_id: str, tenant_id: Optional[str] = None) -> Optional[dict]:
        """
        Get trigger log by ID

        Args:
            workflow_trigger_log_id: ID of the trigger log
            tenant_id: Optional tenant ID for security check

        Returns:
            Trigger log as dictionary or None if not found
        """
        with Session(db.engine) as session:
            trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
            trigger_log = trigger_log_repo.get_by_id(workflow_trigger_log_id, tenant_id)

            if not trigger_log:
                return None

            return trigger_log.to_dict()

    @classmethod
    def get_recent_logs(
        cls, tenant_id: str, app_id: str, hours: int = 24, limit: int = 100, offset: int = 0
    ) -> list[dict]:
        """
        Get recent trigger logs

        Args:
            tenant_id: Tenant ID
            app_id: Application ID
            hours: Number of hours to look back
            limit: Maximum number of results
            offset: Number of results to skip

        Returns:
            List of trigger logs as dictionaries
        """
        with Session(db.engine) as session:
            trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
            logs = trigger_log_repo.get_recent_logs(
                tenant_id=tenant_id, app_id=app_id, hours=hours, limit=limit, offset=offset
            )

            return [log.to_dict() for log in logs]

    @classmethod
    def get_failed_logs_for_retry(cls, tenant_id: str, max_retry_count: int = 3, limit: int = 100) -> list[dict]:
        """
        Get failed logs eligible for retry

        Args:
            tenant_id: Tenant ID
            max_retry_count: Maximum retry count
            limit: Maximum number of results

        Returns:
            List of failed trigger logs as dictionaries
        """
        with Session(db.engine) as session:
            trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
            logs = trigger_log_repo.get_failed_for_retry(
                tenant_id=tenant_id, max_retry_count=max_retry_count, limit=limit
            )

            return [log.to_dict() for log in logs]

    @staticmethod
    def _get_workflow(workflow_service: WorkflowService, app_model: App, workflow_id: Optional[str] = None) -> Workflow:
        """
        Get workflow for the app

        Args:
            app_model: App model instance
            workflow_id: Optional specific workflow ID

        Returns:
            Workflow instance

        Raises:
            ValueError: If workflow not found
        """
        if workflow_id:
            # Get specific published workflow
            workflow = workflow_service.get_published_workflow_by_id(app_model, workflow_id)
            if not workflow:
                raise ValueError(f"Published workflow not found: {workflow_id}")
        else:
            # Get default published workflow
            workflow = workflow_service.get_published_workflow(app_model)
            if not workflow:
                raise ValueError(f"No published workflow found for app: {app_model.id}")

        return workflow
