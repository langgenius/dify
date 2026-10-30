"""Celery tasks for async workflow execution."""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from threading import Event, Thread
from typing import Any, Protocol, cast
from uuid import uuid4

from celery import Task, shared_task
from redis.exceptions import LockNotOwnedError, RedisError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from typing_extensions import TypedDict

from configs import dify_config
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.app.layers.trigger_post_layer import TriggerPostLayer
from core.db.session_factory import session_factory
from enums import DeploymentEdition
from enums.creator import CreatorUserRole
from extensions.ext_redis import redis_client
from models.account import Account
from models.enums import WorkflowTriggerStatus
from models.model import App, EndUser, Tenant
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.errors.app import WorkflowNotFoundError
from services.knowledge.retrieval.retrieval import KnowledgeRetriever
from services.workflow.entities import TriggerData, WorkflowTaskData
from services.workflow_run_agg import WorkflowRunAgg
from tasks.app_generate.workflow_execute_task import WorkflowTriggerPublicationError, _resume_app_execution

logger = logging.getLogger(__name__)

_EXECUTION_LEASE_TIMEOUT_SECONDS = 120
_EXECUTION_LEASE_HEARTBEAT_SECONDS = 30
_EXECUTION_LEASE_JOIN_TIMEOUT_SECONDS = 5

if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
    _PROFESSIONAL_QUEUE = "workflow_professional"
    _TEAM_QUEUE = "workflow_team"
    _SANDBOX_QUEUE = "workflow_sandbox"
else:
    _PROFESSIONAL_QUEUE = "workflow"
    _TEAM_QUEUE = "workflow"
    _SANDBOX_QUEUE = "workflow"


class WorkflowGeneratorArgsDict(TypedDict):
    inputs: dict[str, Any]
    files: list[Any]


class _RedisExecutionLock(Protocol):
    def acquire(self, *, blocking: bool, token: str) -> bool: ...

    def reacquire(self) -> bool: ...

    def release(self) -> None: ...


class WorkflowExecutionBusyError(RuntimeError):
    """Another worker still owns this workflow trigger execution."""


class WorkflowExecutionLeaseLostError(RuntimeError):
    """The current worker can no longer publish this execution's result."""


class WorkflowExecutionPublicationError(RuntimeError):
    """Execution returned; retry its persisted result without executing again."""


class _WorkflowExecutionLease:
    """Token-safe renewable lease for one trigger-log execution attempt."""

    def __init__(self, lock: _RedisExecutionLock, *, trigger_log_id: str) -> None:
        self._lock = lock
        self._trigger_log_id = trigger_log_id
        self._lost = Event()

    def renew(self) -> bool:
        if self._lost.is_set():
            return False
        try:
            owned = self._lock.reacquire()
        except LockNotOwnedError:
            owned = False
        except RedisError:
            logger.warning(
                "Could not confirm workflow execution lease ownership: %s",
                self._trigger_log_id,
                exc_info=True,
            )
            raise
        if not owned:
            self._lost.set()
        return owned

    def release(self) -> None:
        if self._lost.is_set():
            return
        try:
            self._lock.release()
        except Exception:
            logger.warning("Failed to release workflow execution lease: %s", self._trigger_log_id, exc_info=True)


@contextmanager
def _hold_workflow_execution(trigger_log_id: str) -> Generator[_WorkflowExecutionLease]:
    lock = cast(
        _RedisExecutionLock,
        redis_client.lock(
            f"workflow-trigger-execution:{trigger_log_id}",
            timeout=_EXECUTION_LEASE_TIMEOUT_SECONDS,
            blocking=False,
            thread_local=False,
        ),
    )
    token = uuid4().hex
    if not lock.acquire(blocking=False, token=token):
        raise WorkflowExecutionBusyError(f"Workflow trigger is already executing: {trigger_log_id}")

    lease = _WorkflowExecutionLease(lock, trigger_log_id=trigger_log_id)
    stopped = Event()

    def renew_while_held() -> None:
        while not stopped.wait(_EXECUTION_LEASE_HEARTBEAT_SECONDS):
            try:
                owned = lease.renew()
            except RedisError:
                # A transport failure is not proof that another worker owns
                # the token. The synchronous publication guard will fail
                # closed if ownership still cannot be confirmed.
                continue
            if not owned:
                logger.error("Workflow execution lease was lost: %s", trigger_log_id)
                return

    heartbeat: Thread | None = None
    try:
        try:
            heartbeat = Thread(
                target=renew_while_held,
                daemon=True,
                name=f"WorkflowTriggerLease({trigger_log_id})",
            )
            heartbeat.start()
        except RuntimeError as error:
            raise WorkflowExecutionBusyError(f"Cannot start workflow execution heartbeat: {trigger_log_id}") from error
        yield lease
        if not lease.renew():
            raise WorkflowExecutionLeaseLostError(f"Workflow execution lease was lost: {trigger_log_id}")
    finally:
        stopped.set()
        if heartbeat is not None and heartbeat.ident is not None:
            heartbeat.join(timeout=_EXECUTION_LEASE_JOIN_TIMEOUT_SECONDS)
            if heartbeat.is_alive():
                logger.warning("Workflow execution lease heartbeat did not stop: %s", trigger_log_id)
        lease.release()


@shared_task(
    queue=_PROFESSIONAL_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(
        RedisError,
        SQLAlchemyError,
        WorkflowExecutionBusyError,
        WorkflowExecutionLeaseLostError,
        WorkflowExecutionPublicationError,
    ),
    retry_backoff=True,
    max_retries=None,
)
def execute_workflow_professional(task_data_dict: dict[str, Any]) -> None:
    from extensions.ext_application_services import application_services

    _execute_workflow_common(
        WorkflowTaskData.model_validate(task_data_dict),
        knowledge_retrieval=application_services().knowledge.retrieval,
    )


@shared_task(
    queue=_TEAM_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(
        RedisError,
        SQLAlchemyError,
        WorkflowExecutionBusyError,
        WorkflowExecutionLeaseLostError,
        WorkflowExecutionPublicationError,
    ),
    retry_backoff=True,
    max_retries=None,
)
def execute_workflow_team(task_data_dict: dict[str, Any]) -> None:
    from extensions.ext_application_services import application_services

    _execute_workflow_common(
        WorkflowTaskData.model_validate(task_data_dict),
        knowledge_retrieval=application_services().knowledge.retrieval,
    )


@shared_task(
    queue=_SANDBOX_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(
        RedisError,
        SQLAlchemyError,
        WorkflowExecutionBusyError,
        WorkflowExecutionLeaseLostError,
        WorkflowExecutionPublicationError,
    ),
    retry_backoff=True,
    max_retries=None,
)
def execute_workflow_sandbox(task_data_dict: dict[str, Any]) -> None:
    from extensions.ext_application_services import application_services

    _execute_workflow_common(
        WorkflowTaskData.model_validate(task_data_dict),
        knowledge_retrieval=application_services().knowledge.retrieval,
    )


def _build_generator_args(trigger_data: TriggerData) -> WorkflowGeneratorArgsDict:
    return {
        "inputs": dict(trigger_data.inputs),
        "files": list(trigger_data.files),
    }


def _execute_workflow_common(task_data: WorkflowTaskData, *, knowledge_retrieval: KnowledgeRetriever) -> None:
    """Execute workflow with common logic and trigger log updates."""
    with session_factory.create_session() as session:
        trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
        initial_trigger_log = trigger_log_repo.get_by_id(task_data.workflow_trigger_log_id)
        if initial_trigger_log is None:
            logger.error("Workflow trigger log not found: %s", task_data.workflow_trigger_log_id)
            return
        if initial_trigger_log.status not in {
            WorkflowTriggerStatus.PENDING,
            WorkflowTriggerStatus.QUEUED,
            WorkflowTriggerStatus.RUNNING,
        }:
            logger.info("Workflow trigger log is not executable: %s", task_data.workflow_trigger_log_id)
            return
        with _hold_workflow_execution(task_data.workflow_trigger_log_id) as execution_lease:
            if initial_trigger_log.status == WorkflowTriggerStatus.RUNNING:
                current = trigger_log_repo.lock_for_execution_update(
                    trigger_log_id=task_data.workflow_trigger_log_id,
                )
                if current is None or current.status != WorkflowTriggerStatus.RUNNING:
                    session.rollback()
                    return
                if not execution_lease.renew():
                    session.rollback()
                    return
                if current.workflow_run_id is not None:
                    trigger_log_repo.reconcile_published_run_result(current.workflow_run_id, include_paused=True)
                    if current.status != WorkflowTriggerStatus.RUNNING:
                        session.commit()
                        return
                current.status = WorkflowTriggerStatus.FAILED
                current.error = (
                    "Workflow worker ownership was lost after execution may have started; "
                    "automatic replay was refused because the result is unknown"
                )
                current.finished_at = datetime.now(UTC)
                trigger_log_repo.update(current)
                session.commit()
                return

            trigger_log = trigger_log_repo.claim_for_execution(
                trigger_log_id=task_data.workflow_trigger_log_id,
            )
            if trigger_log is None:
                session.rollback()
                logger.info("Workflow trigger log is not executable: %s", task_data.workflow_trigger_log_id)
                return

            trigger_data = TriggerData.model_validate_json(trigger_log.trigger_data)
            # Persist the execution identity before invoking the generator so a
            # redelivery can reconstruct a terminal receipt lost in memory.
            trigger_log.workflow_run_id = str(uuid4())
            session.commit()

            start_time = datetime.now(UTC)
            execution_finished = False

            try:
                app_model = session.scalar(select(App).where(App.id == trigger_log.app_id))
                if app_model is None:
                    raise WorkflowNotFoundError(f"App not found: {trigger_log.app_id}")
                workflow = session.scalar(select(Workflow).where(Workflow.id == trigger_log.workflow_id))
                if workflow is None:
                    raise WorkflowNotFoundError(f"Workflow not found: {trigger_log.workflow_id}")
                user = _get_user(session, trigger_log)
                generator = WorkflowAppGenerator(
                    execution_driver=WorkflowRunAgg.run,
                    knowledge_retrieval=knowledge_retrieval,
                )
                pause_config = PauseStateLayerConfig(
                    session_factory=session_factory.get_session_maker(),
                    state_owner_user_id=workflow.created_by,
                )
                session.commit()
                trigger_post_layer = TriggerPostLayer(start_time, trigger_log.id, execution_guard=execution_lease.renew)
                generator.generate(
                    app_model=app_model,
                    workflow=workflow,
                    user=user,
                    args=_build_generator_args(trigger_data),
                    invoke_from=InvokeFrom.SERVICE_API,
                    streaming=False,
                    call_depth=0,
                    workflow_run_id=trigger_log.workflow_run_id,
                    triggered_from=trigger_data.trigger_from,
                    root_node_id=trigger_data.root_node_id,
                    graph_engine_layers=[trigger_post_layer],
                    pause_state_config=pause_config,
                )
                execution_finished = True
                # Graphon logs layer failures instead of propagating them. A
                # successful engine return alone cannot acknowledge publication.
                for attempt in range(3):
                    try:
                        trigger_post_layer.publish_pending_terminal()
                        break
                    except (RedisError, SQLAlchemyError):
                        if attempt == 2:
                            raise
                        logger.warning("Retrying workflow terminal publication: %s", trigger_log.id, exc_info=True)
                current = trigger_log_repo.lock_for_execution_update(trigger_log_id=trigger_log.id)
                if current is not None and current.status == WorkflowTriggerStatus.RUNNING:
                    raise RuntimeError("Workflow returned without publishing its trigger terminal state")
                session.rollback()
            except Exception as error:
                session.rollback()
                if execution_finished:
                    # SQL WorkflowRun and any pause snapshot are already owned
                    # by execution persistence. A projection error cannot turn
                    # that result into an execution failure.
                    raise WorkflowExecutionPublicationError(
                        f"Cannot publish workflow result for trigger {trigger_log.id}"
                    ) from error
                current = trigger_log_repo.lock_for_execution_update(trigger_log_id=trigger_log.id)
                if current is None or current.status != WorkflowTriggerStatus.RUNNING:
                    session.rollback()
                    return
                if not execution_lease.renew():
                    session.rollback()
                    logger.warning("Discarded failure from a stale workflow worker: %s", trigger_log.id)
                    return
                finished_at = datetime.now(UTC)
                current.status = WorkflowTriggerStatus.FAILED
                current.error = str(error)
                current.finished_at = finished_at
                current.elapsed_time = (finished_at - start_time).total_seconds()
                trigger_log_repo.update(current)
                session.commit()


@shared_task(
    bind=True,
    name="resume_workflow_execution",
    autoretry_for=(WorkflowTriggerPublicationError,),
    retry_backoff=True,
    max_retries=None,
)
def resume_workflow_execution(self: Task, task_data_dict: dict[str, Any]) -> None:
    """Consume legacy messages with this task's own retry context."""
    from extensions.ext_application_services import application_services

    _resume_app_execution(
        task_data_dict,
        knowledge_retrieval=application_services().knowledge.retrieval,
        reconcile_only=self.request.retries > 0,
    )


def _get_user(session: Session, workflow_run: WorkflowTriggerLog) -> Account | EndUser:
    tenant = session.scalar(select(Tenant).where(Tenant.id == workflow_run.tenant_id))
    if tenant is None:
        raise _TenantNotFoundError(
            "Tenant not found for WorkflowRun: tenant_id=%s, workflow_run_id=%s",
            workflow_run.tenant_id,
            workflow_run.id,
        )
    if workflow_run.created_by_role == CreatorUserRole.ACCOUNT:
        user = session.scalar(select(Account).where(Account.id == workflow_run.created_by))
        if user:
            user.set_current_tenant_with_session(tenant, session=session)
    else:
        user = session.scalar(select(EndUser).where(EndUser.id == workflow_run.created_by))
    if user is None:
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
