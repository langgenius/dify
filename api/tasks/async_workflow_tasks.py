"""
Celery tasks for async workflow execution.

These tasks handle workflow execution for different subscription tiers
with appropriate retry policies and error handling.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig, WorkflowResumptionContext
from core.app.layers.timeslice_layer import TimeSliceLayer
from core.app.layers.trigger_post_layer import TriggerPostLayer
from core.db.session_factory import session_factory
from core.repositories import DifyCoreRepositoryFactory
from core.workflow.runtime import GraphRuntimeState
from extensions.ext_database import db
from models.account import Account
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom, WorkflowTriggerStatus
from models.model import App, EndUser, Tenant
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.errors.app import WorkflowNotFoundError
from services.workflow.entities import (
    TriggerData,
    WorkflowResumeTaskData,
    WorkflowTaskData,
)
from tasks.workflow_cfs_scheduler.cfs_scheduler import AsyncWorkflowCFSPlanEntity, AsyncWorkflowCFSPlanScheduler
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue, AsyncWorkflowSystemStrategy

logger = logging.getLogger(__name__)


@shared_task(queue=AsyncWorkflowQueue.PROFESSIONAL_QUEUE)
def execute_workflow_professional(task_data_dict: dict[str, Any]):
    """Execute workflow for professional tier with highest priority"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    cfs_plan_scheduler_entity = AsyncWorkflowCFSPlanEntity(
        queue=AsyncWorkflowQueue.PROFESSIONAL_QUEUE,
        schedule_strategy=AsyncWorkflowSystemStrategy,
        granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
    )
    _execute_workflow_common(
        task_data,
        AsyncWorkflowCFSPlanScheduler(plan=cfs_plan_scheduler_entity),
        cfs_plan_scheduler_entity,
    )


@shared_task(queue=AsyncWorkflowQueue.TEAM_QUEUE)
def execute_workflow_team(task_data_dict: dict[str, Any]):
    """Execute workflow for team tier"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    cfs_plan_scheduler_entity = AsyncWorkflowCFSPlanEntity(
        queue=AsyncWorkflowQueue.TEAM_QUEUE,
        schedule_strategy=AsyncWorkflowSystemStrategy,
        granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
    )
    _execute_workflow_common(
        task_data,
        AsyncWorkflowCFSPlanScheduler(plan=cfs_plan_scheduler_entity),
        cfs_plan_scheduler_entity,
    )


@shared_task(queue=AsyncWorkflowQueue.SANDBOX_QUEUE)
def execute_workflow_sandbox(task_data_dict: dict[str, Any]):
    """Execute workflow for free tier with lower retry limit"""
    task_data = WorkflowTaskData.model_validate(task_data_dict)
    cfs_plan_scheduler_entity = AsyncWorkflowCFSPlanEntity(
        queue=AsyncWorkflowQueue.SANDBOX_QUEUE,
        schedule_strategy=AsyncWorkflowSystemStrategy,
        granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
    )
    _execute_workflow_common(
        task_data,
        AsyncWorkflowCFSPlanScheduler(plan=cfs_plan_scheduler_entity),
        cfs_plan_scheduler_entity,
    )


def _build_generator_args(trigger_data: TriggerData) -> dict[str, Any]:
    """Build args passed into WorkflowAppGenerator.generate for Celery executions."""

    args: dict[str, Any] = {
        "inputs": dict(trigger_data.inputs),
        "files": list(trigger_data.files),
        SKIP_PREPARE_USER_INPUTS_KEY: True,
    }
    return args


def _execute_workflow_common(
    task_data: WorkflowTaskData,
    cfs_plan_scheduler: AsyncWorkflowCFSPlanScheduler,
    cfs_plan_scheduler_entity: AsyncWorkflowCFSPlanEntity,
):
    """Execute workflow with common logic and trigger log updates."""

    with session_factory.create_session() as session:
        trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)

        # Get trigger log
        trigger_log = trigger_log_repo.get_by_id(task_data.workflow_trigger_log_id)

        if not trigger_log:
            # This should not happen, but handle gracefully
            return

        # Reconstruct execution data from trigger log
        trigger_data = TriggerData.model_validate_json(trigger_log.trigger_data)

        # Update status to running
        trigger_log.status = WorkflowTriggerStatus.RUNNING
        trigger_log_repo.update(trigger_log)
        session.commit()

        start_time = datetime.now(UTC)

        try:
            # Get app and workflow models
            app_model = session.scalar(select(App).where(App.id == trigger_log.app_id))

            if not app_model:
                raise WorkflowNotFoundError(f"App not found: {trigger_log.app_id}")

            workflow = session.scalar(select(Workflow).where(Workflow.id == trigger_log.workflow_id))
            if not workflow:
                raise WorkflowNotFoundError(f"Workflow not found: {trigger_log.workflow_id}")

            user = _get_user(session, trigger_log)

            # Execute workflow using WorkflowAppGenerator
            generator = WorkflowAppGenerator()

            # Prepare args matching AppGenerateService.generate format
            args = _build_generator_args(trigger_data)

            # If workflow_id was specified, add it to args
            if trigger_data.workflow_id:
                args["workflow_id"] = str(trigger_data.workflow_id)

            pause_config = PauseStateLayerConfig(
                session_factory=session_factory.get_session_maker(),
                state_owner_user_id=workflow.created_by,
            )

            # Execute the workflow with the trigger type
            generator.generate(
                app_model=app_model,
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                call_depth=0,
                triggered_from=trigger_data.trigger_from,
                root_node_id=trigger_data.root_node_id,
                graph_engine_layers=[
                    # TODO: Re-enable TimeSliceLayer after the HITL release.
                    TriggerPostLayer(cfs_plan_scheduler_entity, start_time, trigger_log.id),
                ],
                pause_state_config=pause_config,
            )

        except Exception as e:
            # Calculate elapsed time for failed execution
            elapsed_time = (datetime.now(UTC) - start_time).total_seconds()

            # Update trigger log with failure
            trigger_log.status = WorkflowTriggerStatus.FAILED
            trigger_log.error = str(e)
            trigger_log.finished_at = datetime.now(UTC)
            trigger_log.elapsed_time = elapsed_time
            trigger_log_repo.update(trigger_log)

            # Final failure - no retry logic (simplified like RAG tasks)
            session.commit()


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

    graph_runtime_state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)

    with session_factory() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.id == workflow_run.workflow_id))
        if workflow is None:
            raise WorkflowNotFoundError(
                "Workflow not found: workflow_run_id=%s, workflow_id=%s", workflow_run.id, workflow_run.workflow_id
            )
        user = _get_user(session, workflow_run)
        app_model = session.scalar(select(App).where(App.id == workflow_run.app_id))
        if app_model is None:
            raise _AppNotFoundError(
                "App not found: app_id=%s, workflow_run_id=%s", workflow_run.app_id, workflow_run.id
            )

    workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
        session_factory=session_factory,
        user=user,
        app_id=generate_entity.app_config.app_id,
        triggered_from=WorkflowRunTriggeredFrom(workflow_run.triggered_from),
    )
    workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
        session_factory=session_factory,
        user=user,
        app_id=generate_entity.app_config.app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    pause_config = PauseStateLayerConfig(
        session_factory=session_factory,
        state_owner_user_id=workflow.created_by,
    )

    generator = WorkflowAppGenerator()
    start_time = datetime.now(UTC)
    graph_engine_layers = []
    trigger_log = _query_trigger_log_info(session_factory, task_data.workflow_run_id)

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
                TriggerPostLayer(cfs_plan_scheduler_entity, start_time, trigger_log.id),
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
    )
    workflow_run_repo.delete_workflow_pause(pause_entity)


def _get_user(session: Session, workflow_run: WorkflowRun | WorkflowTriggerLog) -> Account | EndUser:
    """Compose user from trigger log"""
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
            user.current_tenant = tenant
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


def _query_trigger_log_info(session_factory: sessionmaker[Session], workflow_run_id) -> WorkflowTriggerLog | None:
    with session_factory() as session, session.begin():
        trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        trigger_log = trigger_log_repo.get_by_workflow_run_id(workflow_run_id)
        if not trigger_log:
            logger.debug("Trigger log not found for workflow_run: workflow_run_id=%s", workflow_run_id)
            return None

        return trigger_log


class _TenantNotFoundError(Exception):
    pass


class _UserNotFoundError(Exception):
    pass


class _AppNotFoundError(Exception):
    pass
