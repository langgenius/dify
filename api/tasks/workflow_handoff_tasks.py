import hashlib
import logging
import os
import socket
from datetime import timedelta
from typing import Any

from celery import Task, shared_task
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.workflow_handoff import RagPipelineHandoffGroupIdentity, RagPipelineQueueKind, WorkflowRunHandoff
from repositories.rag_pipeline_handoff_group_repository import SQLAlchemyRagPipelineHandoffGroupRepository
from repositories.sqlalchemy_workflow_handoff_repository import SQLAlchemyWorkflowRunHandoffRepository
from services.rag_pipeline.rag_pipeline_handoff_group_service import RagPipelineHandoffGroupService
from services.workflow_handoff_dispatcher import WorkflowHandoffDispatcher
from services.workflow_handoff_resume_coordinator import (
    WorkflowHandoffResumeCoordinator,
    WorkflowHandoffResumeDispatcher,
)
from services.workflow_handoff_service import WorkflowHandoffService
from services.workflow_handoff_terminal_service import WorkflowHandoffTerminalService
from tasks.rag_pipeline.rag_pipeline_task_support import RAG_PIPELINE_DISPATCH_TOKEN_HEADER

logger = logging.getLogger(__name__)

WORKFLOW_HANDOFF_SCAN_BATCH_SIZE = 100
WORKFLOW_HANDOFF_SCAN_TASK_NAME = "workflow_handoff.scan"
WORKFLOW_HANDOFF_RESUME_TASK_NAME = "workflow_handoff.resume"


def _create_repository() -> SQLAlchemyWorkflowRunHandoffRepository:
    return SQLAlchemyWorkflowRunHandoffRepository(
        sessionmaker(bind=db.engine, expire_on_commit=False),
    )


def _create_resume_coordinator(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> WorkflowHandoffResumeCoordinator:
    return WorkflowHandoffResumeCoordinator(
        repository=repository,
        handoff_service=WorkflowHandoffService(repository=repository, storage=storage),
        lease_duration=timedelta(seconds=dify_config.WORKFLOW_HANDOFF_LEASE_SECONDS),
        retry_delay=timedelta(seconds=dify_config.WORKFLOW_HANDOFF_SCAN_INTERVAL_SECONDS),
        max_attempts=dify_config.WORKFLOW_HANDOFF_MAX_ATTEMPTS,
    )


def _create_resume_dispatcher() -> WorkflowHandoffResumeDispatcher:
    # Imported lazily so route-specific generators do not become import-time
    # dependencies of Celery beat or the lightweight scanner task.
    from services.workflow_handoff_resume_routes import create_workflow_handoff_resume_dispatcher

    return create_workflow_handoff_resume_dispatcher()


def _create_rag_handoff_group_service() -> RagPipelineHandoffGroupService:
    def _enqueue_regular(file_id: str, tenant_id: str, dispatch_token: str) -> None:
        from tasks.rag_pipeline.rag_pipeline_run_task import rag_pipeline_run_task

        rag_pipeline_run_task.apply_async(
            kwargs={
                "rag_pipeline_invoke_entities_file_id": file_id,
                "tenant_id": tenant_id,
            },
            headers={RAG_PIPELINE_DISPATCH_TOKEN_HEADER: dispatch_token},
            queue=dify_config.WORKFLOW_HANDOFF_QUEUE,
        )

    def _enqueue_priority(file_id: str, tenant_id: str, dispatch_token: str) -> None:
        from tasks.rag_pipeline.priority_rag_pipeline_run_task import priority_rag_pipeline_run_task

        priority_rag_pipeline_run_task.apply_async(
            kwargs={
                "rag_pipeline_invoke_entities_file_id": file_id,
                "tenant_id": tenant_id,
            },
            headers={RAG_PIPELINE_DISPATCH_TOKEN_HEADER: dispatch_token},
            queue=dify_config.WORKFLOW_HANDOFF_QUEUE,
        )

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    return RagPipelineHandoffGroupService(
        repository=SQLAlchemyRagPipelineHandoffGroupRepository(session_factory),
        regular_enqueue=_enqueue_regular,
        priority_enqueue=_enqueue_priority,
    )


def _create_terminal_service(
    repository: SQLAlchemyWorkflowRunHandoffRepository,
) -> WorkflowHandoffTerminalService:
    return WorkflowHandoffTerminalService(repository=repository, storage=storage)


def _rag_group_identity(handoff: WorkflowRunHandoff) -> RagPipelineHandoffGroupIdentity | None:
    if (
        not isinstance(handoff.rag_source_batch_id, str)
        or not isinstance(handoff.rag_tenant_id, str)
        or not isinstance(handoff.rag_queue_kind, RagPipelineQueueKind)
    ):
        return None
    return RagPipelineHandoffGroupIdentity(
        source_batch_id=handoff.rag_source_batch_id,
        tenant_id=handoff.rag_tenant_id,
        queue_kind=handoff.rag_queue_kind,
    )


def _enqueue_workflow_handoff_resume(handoff_id: str, generation: int) -> None:
    resume_workflow_handoff_task.apply_async(
        kwargs={"handoff_id": handoff_id, "generation": generation},
        queue=dify_config.WORKFLOW_HANDOFF_QUEUE,
    )


def _build_lease_owner(*, hostname: str, process_id: int, celery_task_id: str) -> str:
    identity = f"{hostname}:{process_id}:{celery_task_id}"
    if len(identity) <= 255:
        return identity
    digest = hashlib.sha256(identity.encode()).hexdigest()
    return f"{hostname[:170]}:{process_id}:{digest}"


@shared_task(queue=dify_config.WORKFLOW_HANDOFF_QUEUE, name=WORKFLOW_HANDOFF_SCAN_TASK_NAME)
def scan_workflow_handoffs_task() -> dict[str, int | str]:
    repository = _create_repository()
    now = naive_utc_now()
    result = WorkflowHandoffDispatcher(
        repository=repository,
        enqueue=_enqueue_workflow_handoff_resume,
    ).scan(
        now=now,
        # A dispatched message that has not claimed the row by one full lease
        # may have been lost. Redispatching is safe because claim is fenced.
        redispatch_interval=timedelta(seconds=dify_config.WORKFLOW_HANDOFF_LEASE_SECONDS),
        prepared_timeout=timedelta(seconds=dify_config.WORKFLOW_HANDOFF_DRAIN_TIMEOUT_SECONDS),
        max_attempts=dify_config.WORKFLOW_HANDOFF_MAX_ATTEMPTS,
        limit=WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
    )
    rag_result = _create_rag_handoff_group_service().scan(
        now=now,
        limit=WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
    )
    # RAG group reconciliation observes FAILED rows first so it can repair
    # document state and release tenant slots before terminal events and blob
    # collection advance those handoffs.
    terminal_result = _create_terminal_service(repository).scan(
        now=now,
        limit=WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
        retry_delay=timedelta(seconds=dify_config.WORKFLOW_HANDOFF_SCAN_INTERVAL_SECONDS),
    )
    retention_before = now - timedelta(days=dify_config.WORKFLOW_HANDOFF_RETENTION_DAYS)
    terminal_handoffs_deleted = 0
    completed_snapshot_gc_deleted = 0
    retention_errors = 0
    try:
        terminal_handoffs_deleted = repository.cleanup_terminal_handoffs(
            terminal_before=retention_before,
            limit=WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
        )
    except Exception:
        retention_errors += 1
        logger.exception("Failed to clean up retained terminal workflow handoffs")
    try:
        completed_snapshot_gc_deleted = repository.cleanup_completed_snapshot_gc(
            deleted_before=retention_before,
            limit=WORKFLOW_HANDOFF_SCAN_BATCH_SIZE,
        )
    except Exception:
        retention_errors += 1
        logger.exception("Failed to clean up completed workflow handoff snapshot-GC rows")
    logger.info(
        "Workflow handoff scan completed: due=%s, enqueued=%s, marked=%s, errors=%s, "
        "exhausted=%s, stale_prepared=%s, stale_ready=%s, terminal_compensated=%s, "
        "terminal_compensation_errors=%s, terminal_events_published=%s, terminal_event_errors=%s, "
        "snapshots_deleted=%s, snapshots_missing=%s, snapshot_gc_errors=%s, cancellations_deleted=%s, "
        "terminal_handoffs_deleted=%s, completed_snapshot_gc_deleted=%s, retention_errors=%s",
        result.due,
        result.enqueued,
        result.dispatch_marked,
        result.errors,
        result.exhausted_failed,
        result.stale_prepared_failed,
        result.stale_ready_failed,
        terminal_result.terminal_compensated,
        terminal_result.terminal_compensation_errors,
        terminal_result.terminal_events_published,
        terminal_result.terminal_event_errors,
        terminal_result.snapshots_deleted,
        terminal_result.snapshots_missing,
        terminal_result.snapshot_gc_errors,
        terminal_result.cancellations_deleted,
        terminal_handoffs_deleted,
        completed_snapshot_gc_deleted,
        retention_errors,
    )
    return {
        "status": "ok",
        "due": result.due,
        "enqueued": result.enqueued,
        "dispatch_marked": result.dispatch_marked,
        "errors": result.errors,
        "exhausted_failed": result.exhausted_failed,
        "stale_prepared_failed": result.stale_prepared_failed,
        "stale_ready_failed": result.stale_ready_failed,
        "rag_groups_scanned": rag_result.scanned,
        "rag_groups_released": rag_result.released,
        "rag_group_errors": rag_result.errors,
        "terminal_compensated": terminal_result.terminal_compensated,
        "terminal_compensation_errors": terminal_result.terminal_compensation_errors,
        "terminal_events_published": terminal_result.terminal_events_published,
        "terminal_event_errors": terminal_result.terminal_event_errors,
        "snapshots_deleted": terminal_result.snapshots_deleted,
        "snapshots_missing": terminal_result.snapshots_missing,
        "snapshot_gc_errors": terminal_result.snapshot_gc_errors,
        "cancellations_deleted": terminal_result.cancellations_deleted,
        "terminal_handoffs_deleted": terminal_handoffs_deleted,
        "completed_snapshot_gc_deleted": completed_snapshot_gc_deleted,
        "retention_errors": retention_errors,
    }


@shared_task(bind=True, name=WORKFLOW_HANDOFF_RESUME_TASK_NAME)
def resume_workflow_handoff_task(
    task: Task,
    *,
    handoff_id: str,
    generation: int,
) -> dict[str, Any]:
    request = task.request
    hostname = getattr(request, "hostname", None) or socket.gethostname()
    celery_task_id = getattr(request, "id", None) or str(uuidv7())
    lease_owner = _build_lease_owner(
        hostname=hostname,
        process_id=os.getpid(),
        celery_task_id=celery_task_id,
    )

    repository = _create_repository()
    result = _create_resume_coordinator(repository).resume(
        handoff_id=handoff_id,
        generation=generation,
        lease_owner=lease_owner,
        now=naive_utc_now(),
        dispatcher=_create_resume_dispatcher(),
    )
    handoff = repository.get(handoff_id, generation)
    identity = _rag_group_identity(handoff) if handoff is not None else None
    if identity is not None:
        try:
            _create_rag_handoff_group_service().reconcile_group(identity=identity, now=naive_utc_now())
        except Exception:
            # The durable scanner owns compensation; the graph resume outcome
            # must not be retried after acknowledgement merely because Redis is
            # briefly unavailable during tenant-slot release.
            logger.exception("Failed to reconcile RAG handoff group after resume: %s", identity)
    logger.info(
        "Workflow handoff resume task completed: handoff_id=%s, generation=%s, outcome=%s",
        handoff_id,
        generation,
        result.outcome,
    )
    return {
        "status": result.outcome.value,
        "handoff_id": result.handoff_id,
        "generation": result.generation,
        "error": result.error,
    }


__all__ = [
    "WORKFLOW_HANDOFF_RESUME_TASK_NAME",
    "WORKFLOW_HANDOFF_SCAN_TASK_NAME",
    "resume_workflow_handoff_task",
    "scan_workflow_handoffs_task",
]
