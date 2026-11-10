"""
Celery tasks for async workflow execution.

These tasks handle workflow execution for different subscription tiers
with appropriate retry policies and error handling.
"""

import logging
from datetime import UTC, datetime
from functools import partial
from typing import Any
from uuid import UUID

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig, WorkflowResumptionContext
from core.app.layers.timeslice_layer import TimeSliceLayer
from core.repositories import DifyCoreRepositoryFactory
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from graphon.runtime import RuntimeState
from models.account import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, EndUser, Tenant
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from services.app_task_service import AppTaskService
from services.errors.app import WorkflowNotFoundError
from services.human_input_v2.submission_service import HumanInputSubmissionService
from services.trigger.execution_layer import TriggerPostLayer
from services.workflow.entities import (
    WorkflowResumeTaskData,
    WorkflowTaskData,
)
from services.workflow_run_agg import WorkflowRunAgg
from tasks.workflow_cfs_scheduler.cfs_scheduler import AsyncWorkflowCFSPlanEntity, AsyncWorkflowCFSPlanScheduler
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue, AsyncWorkflowSystemStrategy

logger = logging.getLogger(__name__)


@shared_task(queue=AsyncWorkflowQueue.PROFESSIONAL_QUEUE)
def execute_workflow_professional(task_data_dict: dict[str, Any]) -> None:
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    application_services().triggers.executions.execute(task_data.workflow_trigger_log_id)


@shared_task(queue=AsyncWorkflowQueue.TEAM_QUEUE)
def execute_workflow_team(task_data_dict: dict[str, Any]) -> None:
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    application_services().triggers.executions.execute(task_data.workflow_trigger_log_id)


@shared_task(queue=AsyncWorkflowQueue.SANDBOX_QUEUE)
def execute_workflow_sandbox(task_data_dict: dict[str, Any]) -> None:
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    application_services().triggers.executions.execute(task_data.workflow_trigger_log_id)


@shared_task(name="resume_workflow_execution")
def resume_workflow_execution(task_data_dict: dict[str, Any]) -> None:
    """Resume a paused workflow run via Celery."""
    task_data = WorkflowResumeTaskData.model_validate(task_data_dict)
    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_factory)

    pause_entity = workflow_run_repo.get_workflow_pause(task_data.workflow_run_id)
    if pause_entity is None:
        logger.warning("No pause state for workflow run %s", task_data.workflow_run_id)
        return
    workflow_run = workflow_run_repo.get_workflow_run_by_id_without_tenant(pause_entity.workflow_execution_id)
    if workflow_run is None:
        logger.warning("Workflow run not found for pause entity: pause_entity_id=%s", pause_entity.id)
        return

    try:
        resumption_context = WorkflowResumptionContext.loads(pause_entity.get_state().decode())
    except Exception as exc:
        logger.exception("Failed to load resumption context for workflow run %s", task_data.workflow_run_id)
        raise exc

    generate_entity = resumption_context.get_generate_entity()
    if not isinstance(generate_entity, WorkflowAppGenerateEntity):
        logger.error(
            "Unsupported resumption entity for workflow run %s: %s",
            task_data.workflow_run_id,
            type(generate_entity),
        )
        return

    # TODO: Remove legacy task recovery 30 days after the last legacy writer is retired.
    task_id = workflow_run.task_id
    if task_id is None:
        try:
            task_id = str(UUID(generate_entity.task_id))
        except ValueError:
            logger.warning("Invalid saved task ID for workflow run %s", task_data.workflow_run_id)
            return
        AppTaskService.index_workflow_pause_task(
            workflow_run=workflow_run,
            pause_entity=pause_entity,
            resumption_context=resumption_context,
            workflow_run_repo=workflow_run_repo,
        )
        indexed_run = workflow_run_repo.get_workflow_run_by_id(
            workflow_run.tenant_id, workflow_run.app_id, workflow_run.id
        )
        if indexed_run is None or indexed_run.task_id != task_id:
            logger.warning("Cannot recover saved task ownership for workflow run %s", task_data.workflow_run_id)
            return
        workflow_run.task_id = task_id
    generate_entity.task_id = task_id

    graph_runtime_state = RuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)
    response_stream_filter = resumption_context.get_response_stream_filter()

    with session_factory() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.id == workflow_run.workflow_id))
        if workflow is None:
            raise WorkflowNotFoundError(
                f"Workflow not found: workflow_run_id={workflow_run.id}, workflow_id={workflow_run.workflow_id}"
            )
        user = _get_user(session, workflow_run)
        app_model = session.scalar(select(App).where(App.id == workflow_run.app_id))
        if app_model is None:
            raise _AppNotFoundError(f"App not found: app_id={workflow_run.app_id}, workflow_run_id={workflow_run.id}")

    workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
        session_factory=session_factory,
        tenant_id=app_model.tenant_id,
        user=user,
        app_id=generate_entity.app_config.app_id,
        triggered_from=WorkflowRunTriggeredFrom(workflow_run.triggered_from),
    )
    workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
        session_factory=session_factory,
        tenant_id=app_model.tenant_id,
        user=user,
        app_id=generate_entity.app_config.app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    pause_config = PauseStateLayerConfig(
        session_factory=session_factory,
        state_owner_user_id=workflow.created_by,
    )

    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    start_time = datetime.now(UTC)
    graph_engine_layers = []
    trigger_logs = application_services().triggers.execution_logs
    trigger_log = trigger_logs.find_for_run(
        tenant_id=workflow_run.tenant_id, app_id=workflow_run.app_id, workflow_run_id=task_data.workflow_run_id
    )

    if trigger_log:
        cfs_plan_scheduler_entity = AsyncWorkflowCFSPlanEntity(
            queue=AsyncWorkflowQueue(trigger_log.queue_name),
            schedule_strategy=AsyncWorkflowSystemStrategy,
            granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
        )
        cfs_plan_scheduler = AsyncWorkflowCFSPlanScheduler(plan=cfs_plan_scheduler_entity)

        graph_engine_layers.extend(
            [
                TimeSliceLayer(cfs_plan_scheduler),
                TriggerPostLayer(logs=trigger_logs, log=trigger_log, start_time=start_time),
            ]
        )

    workflow_run_repo.resume_workflow_pause(task_data.workflow_run_id, pause_entity)

    generator.resume(
        app_model=app_model,
        workflow=workflow,
        user=user,
        application_generate_entity=generate_entity,
        graph_runtime_state=graph_runtime_state,
        workflow_execution_repository=workflow_execution_repository,
        workflow_node_execution_repository=workflow_node_execution_repository,
        graph_engine_layers=graph_engine_layers,
        pause_state_config=pause_config,
        response_stream_filter=response_stream_filter,
        restore_file_access=partial(
            HumanInputSubmissionService(session_factory=session_factory).grant_submitted_file_access,
            app_id=app_model.id,
            workflow_run_id=workflow_run.id,
        ),
    )
    workflow_run_repo.delete_workflow_pause(pause_entity)


def _get_user(session: Session, workflow_run: WorkflowRun) -> Account | EndUser:
    """Legacy HITL resume hydration; trigger task execution uses its scoped repository."""
    tenant = session.scalar(select(Tenant).where(Tenant.id == workflow_run.tenant_id))
    if not tenant:
        raise _TenantNotFoundError(
            "Tenant not found for WorkflowRun: tenant_id=%s, workflow_run_id=%s",
            workflow_run.tenant_id,
            workflow_run.id,
        )

    # Get user from trigger log
    if workflow_run.created_by_role == CreatorUserRole.ACCOUNT:
        user = session.scalar(select(Account).where(Account.id == workflow_run.created_by))
        if user:
            user.set_current_tenant_with_session(tenant, session=session)
    else:  # CreatorUserRole.END_USER
        user = session.scalar(select(EndUser).where(EndUser.id == workflow_run.created_by))

    if not user:
        raise _UserNotFoundError(
            "User not found: user_id=%s, created_by_role=%s, workflow_run_id=%s",
            workflow_run.created_by,
            workflow_run.created_by_role,
            workflow_run.id,
        )

    return user


class _TenantNotFoundError(Exception):
    pass


class _UserNotFoundError(Exception):
    pass


class _AppNotFoundError(Exception):
    pass
