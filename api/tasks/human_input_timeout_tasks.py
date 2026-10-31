import logging
from datetime import timedelta

from celery import shared_task
from kombu.exceptions import OperationalError as BrokerOperationalError
from sqlalchemy import or_, select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.db.session_factory import session_factory as v2_session_factory
from core.human_input_v2.shared.values import TenantId
from enums.human_input import HumanInputFormKind, HumanInputFormStatus
from extensions.ext_database import db
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.enums import CreatorUserRole
from models.human_input import HumanInputForm
from models.workflow import WorkflowPause, WorkflowRun
from repositories.human_input.form_repository import HumanInputFormSubmissionRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormExpirationRepository
from repositories.workflow.execution_write_repository import sync_debug_lease_status
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.human_input_service import HumanInputService
from services.human_input_v2.form_service import handle_form_timeouts
from tasks.app_generate.workflow_execute_task import WORKFLOW_BASED_APP_EXECUTION_QUEUE

logger = logging.getLogger(__name__)


@shared_task(name="human_input_form_timeout.check_and_resume", queue="schedule_executor")
def check_and_handle_human_input_timeouts(limit: int = 100) -> None:
    """Keep legacy expiration handling and fan out independent v2 timeout tasks."""
    _handle_legacy_human_input_timeouts(limit)
    _enqueue_human_input_v2_timeouts(limit)


def _enqueue_human_input_v2_timeouts(limit: int) -> None:
    """Discover candidate runs without settling forms in the periodic task."""
    now = naive_utc_now()
    with v2_session_factory.create_session() as session:
        runs = SQLAlchemyFormExpirationRepository(session).list_expired_runs(now=now, limit=limit)

    for run in runs:
        try:
            handle_human_input_v2_timeout.apply_async(
                kwargs={"tenant_id": run.tenant_id, "app_id": run.app_id, "workflow_run_id": run.workflow_run_id}
            )
        except BrokerOperationalError:
            logger.exception(
                "Failed to enqueue v2 timeout: tenant_id=%s app_id=%s workflow_run_id=%s",
                run.tenant_id,
                run.app_id,
                run.workflow_run_id,
            )


@shared_task(name="human_input_v2_form_timeout.handle", queue=WORKFLOW_BASED_APP_EXECUTION_QUEUE)
def handle_human_input_v2_timeout(tenant_id: str, app_id: str, workflow_run_id: str) -> None:
    """Settle one run using current persisted state, then enqueue resume if due."""
    logger.info("Handling v2 timeout: tenant_id=%s app_id=%s workflow_run_id=%s", tenant_id, app_id, workflow_run_id)
    handle_form_timeouts(
        session_factory=v2_session_factory.get_session_maker(),
        tenant_id=TenantId(tenant_id),
        app_id=app_id,
        workflow_run_id=workflow_run_id,
    )


def _is_global_timeout(form_model: HumanInputForm, global_timeout_seconds: int, *, now) -> bool:
    if global_timeout_seconds <= 0:
        return False
    if form_model.workflow_run_id is None:
        return False
    created_at = ensure_naive_utc(form_model.created_at)
    global_deadline = created_at + timedelta(seconds=global_timeout_seconds)
    return global_deadline <= now


def _handle_global_timeout(*, form_id: str, workflow_run_id: str, node_id: str, session_factory: sessionmaker) -> None:
    now = naive_utc_now()
    with session_factory() as session, session.begin():
        workflow_run = session.scalar(
            select(WorkflowRun)
            .join(
                HumanInputForm,
                (HumanInputForm.workflow_run_id == WorkflowRun.id)
                & (HumanInputForm.tenant_id == WorkflowRun.tenant_id)
                & (HumanInputForm.app_id == WorkflowRun.app_id),
            )
            .where(HumanInputForm.id == form_id, WorkflowRun.id == workflow_run_id)
            .with_for_update(of=WorkflowRun)
        )
        if workflow_run is None:
            return
        if not workflow_run.status.is_ended():
            workflow_run.status = WorkflowExecutionStatus.STOPPED
            workflow_run.error = f"Human input global timeout at node {node_id}"
            workflow_run.finished_at = now
            session.add(workflow_run)
            sync_debug_lease_status(session, workflow_run)

        pause_model = session.scalar(select(WorkflowPause).where(WorkflowPause.workflow_run_id == workflow_run_id))
        state_object_key = None
        if pause_model is not None:
            state_object_key = pause_model.state_object_key
            pause_model.resumed_at = now
            session.add(pause_model)
        tenant_id, app_id, workflow_id = workflow_run.tenant_id, workflow_run.app_id, workflow_run.workflow_id
        account_id = workflow_run.created_by if workflow_run.created_by_role == CreatorUserRole.ACCOUNT else None

    if state_object_key is not None:
        try:
            storage.delete(state_object_key)
        except Exception:
            logger.exception("Failed to delete pause state object for workflow_run_id=%s", workflow_run_id)
    WorkflowAgentRetirementService.finish_execution(
        sessions=session_factory,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        execution_id=workflow_run_id,
        account_id=account_id,
    )


def _handle_legacy_human_input_timeouts(limit: int) -> None:
    """Scan for expired human input forms and resume or end workflows."""

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    form_repo = HumanInputFormSubmissionRepository()
    service = HumanInputService(session_factory, form_repository=form_repo)
    now = naive_utc_now()
    global_timeout_seconds = dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS

    with session_factory() as session:
        global_deadline = now - timedelta(seconds=global_timeout_seconds) if global_timeout_seconds > 0 else None
        timeout_filter = HumanInputForm.expiration_time <= now
        if global_deadline is not None:
            timeout_filter = or_(timeout_filter, HumanInputForm.created_at <= global_deadline)
        stmt = (
            select(HumanInputForm)
            .where(
                HumanInputForm.status == HumanInputFormStatus.WAITING,
                timeout_filter,
            )
            .order_by(HumanInputForm.id.asc())
            .limit(limit)
        )
        expired_forms = session.scalars(stmt).all()

    for form_model in expired_forms:
        try:
            if form_model.form_kind == HumanInputFormKind.DELIVERY_TEST:
                form_repo.mark_timeout(
                    form_id=form_model.id,
                    timeout_status=HumanInputFormStatus.TIMEOUT,
                    reason="delivery_test_timeout",
                )
                continue

            is_global = _is_global_timeout(form_model, global_timeout_seconds, now=now)
            record = form_repo.mark_timeout(
                form_id=form_model.id,
                timeout_status=HumanInputFormStatus.EXPIRED if is_global else HumanInputFormStatus.TIMEOUT,
                reason="global_timeout" if is_global else "node_timeout",
            )
            if is_global:
                # Global timeout applies only to workflow-owned forms
                # (_is_global_timeout requires a workflow_run_id): end the run.
                assert record.workflow_run_id is not None, "global timeout requires a workflow_run_id"
                _handle_global_timeout(
                    form_id=record.form_id,
                    workflow_run_id=record.workflow_run_id,
                    node_id=record.node_id,
                    session_factory=session_factory,
                )
            elif record.workflow_run_id is not None:
                # Human Input node form: resume the workflow.
                service.enqueue_resume(record.workflow_run_id)
            else:
                logger.warning(
                    "Timed-out form %s has no workflow_run_id; skipping resume",
                    record.form_id,
                )
        except Exception:
            logger.exception(
                "Failed to handle timeout for form_id=%s workflow_run_id=%s",
                form_model.id,
                form_model.workflow_run_id,
            )
