"""Dedicated-queue execution for legacy Dataset upgrades."""

from __future__ import annotations

import logging

from celery import shared_task

from core.db.session_factory import session_factory
from services.dataset_knowledge_fs_upgrade_file_lease import cleanup_deferred_upgrade_files
from services.dataset_knowledge_fs_upgrade_service import (
    UPGRADE_CHECKPOINT_TIME_LIMIT_SECONDS,
    KnowledgeFSUpgradeBusyError,
    KnowledgeFSUpgradeDocumentReconciler,
    KnowledgeFSUpgradeNotReadyError,
    KnowledgeFSUpgradeRunner,
    KnowledgeFSUpgradeSnapshotService,
)

KNOWLEDGE_FS_UPGRADE_QUEUE = "knowledge_fs_upgrade"
logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    queue=KNOWLEDGE_FS_UPGRADE_QUEUE,
    max_retries=360,
    default_retry_delay=5,
    acks_late=True,
    reject_on_worker_lost=True,
    soft_time_limit=UPGRADE_CHECKPOINT_TIME_LIMIT_SECONDS - 30,
    time_limit=UPGRADE_CHECKPOINT_TIME_LIMIT_SECONDS,
)
def run_knowledge_fs_upgrade(self, *, job_id: str) -> None:
    """Run one checkpoint and enqueue the next only after it is committed."""

    runner = KnowledgeFSUpgradeRunner(session_factory.get_session_maker())
    try:
        has_more = runner.run_next(job_id=job_id, celery_task_id=self.request.id)
    except KnowledgeFSUpgradeBusyError as error:
        # A redelivery can precede expiry of the lost child's execution window.
        # It must never fail or steal the currently running checkpoint.
        raise self.retry(exc=error, countdown=30) from error
    except KnowledgeFSUpgradeNotReadyError as error:
        if self.request.retries >= self.max_retries:
            runner.fail(job_id=job_id, celery_task_id=self.request.id, error=error)
            logger.exception(
                "KnowledgeFS Dataset upgrade exhausted provisioning retries",
                extra={"upgrade_job_id": job_id},
            )
            raise
        runner.release_for_retry(job_id=job_id, celery_task_id=self.request.id)
        raise self.retry(exc=error) from error
    except Exception as error:
        runner.fail(job_id=job_id, celery_task_id=self.request.id, error=error)
        logger.exception("KnowledgeFS Dataset upgrade failed", extra={"upgrade_job_id": job_id})
        raise
    if has_more is None:
        return
    if has_more:
        _dispatch_next_checkpoint(runner, job_id=job_id, celery_task_id=self.request.id)
    else:
        _dispatch_reconciliations(job_id=job_id)


def _dispatch_next_checkpoint(runner: KnowledgeFSUpgradeRunner, *, job_id: str, celery_task_id: str | None) -> None:
    from services.knowledge.datasets.upgrades import enqueue_upgrade_job

    tenant_id = runner.release_for_dispatch(job_id=job_id, celery_task_id=celery_task_id)
    if tenant_id is None:
        return
    enqueue_upgrade_job(KnowledgeFSUpgradeSnapshotService(session_factory.get_session_maker()), tenant_id, job_id)


@shared_task(
    bind=True,
    queue=KNOWLEDGE_FS_UPGRADE_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    soft_time_limit=UPGRADE_CHECKPOINT_TIME_LIMIT_SECONDS - 30,
    time_limit=UPGRADE_CHECKPOINT_TIME_LIMIT_SECONDS,
)
def reconcile_knowledge_fs_upgrade_documents(self, *, job_id: str) -> None:
    """Apply document checkpoints under a recoverable lease, independent of parent success."""

    reconciler = KnowledgeFSUpgradeDocumentReconciler(session_factory.get_session_maker())
    task_id = self.request.id
    if not reconciler.start_delivery(job_id=job_id, task_id=task_id):
        return
    try:
        reconciler.reconcile(job_id=job_id)
    except Exception:
        logger.warning(
            "KnowledgeFS Dataset upgrade document reconciliation is not ready",
            extra={"upgrade_job_id": job_id},
            exc_info=True,
        )
    finally:
        # Beat retries unfinished checkpoints, including failures to persist this release.
        reconciler.finish_delivery(job_id=job_id, task_id=task_id)


def _dispatch_reconciliations(*, job_id: str | None = None) -> int:
    reconciler = KnowledgeFSUpgradeDocumentReconciler(session_factory.get_session_maker())
    deliveries = reconciler.claim_deliveries(job_id=job_id)
    for tenant_id, pending_job_id, task_id in deliveries:
        try:
            reconcile_knowledge_fs_upgrade_documents.apply_async(kwargs={"job_id": pending_job_id}, task_id=task_id)
        except Exception:
            # Retain the lease after ambiguous publication: a delivered message may already be
            # executing. Beat reclaims it after the bounded worker must have stopped.
            logger.exception(
                "KnowledgeFS upgrade reconciliation dispatch failed tenant_id=%s job_id=%s",
                tenant_id,
                pending_job_id,
            )
    return len(deliveries)


@shared_task(queue=KNOWLEDGE_FS_UPGRADE_QUEUE)
def cleanup_deferred_knowledge_fs_upgrade_files() -> int:
    """Delete orphaned source files after abandoned upgrade leases expire."""

    return cleanup_deferred_upgrade_files(session_factory.get_session_maker())


@shared_task(queue=KNOWLEDGE_FS_UPGRADE_QUEUE)
def recover_stalled_knowledge_fs_upgrades() -> int:
    """Redispatch abandoned checkpoints and publisher claims from durable state."""
    from services.knowledge.datasets.upgrades import enqueue_upgrade_job

    snapshots = KnowledgeFSUpgradeSnapshotService(session_factory.get_session_maker())
    recovered = snapshots.recover_stalled_jobs()
    for tenant_id, job_id in recovered:
        try:
            enqueue_upgrade_job(snapshots, tenant_id, job_id)
            logger.info("Recovered KnowledgeFS upgrade tenant_id=%s job_id=%s", tenant_id, job_id)
        except Exception:
            # The next sweep recovers this unclaimed job even if the broker is down.
            logger.exception("KnowledgeFS upgrade recovery dispatch failed tenant_id=%s job_id=%s", tenant_id, job_id)
    return len(recovered) + _dispatch_reconciliations()


__all__ = [
    "KNOWLEDGE_FS_UPGRADE_QUEUE",
    "cleanup_deferred_knowledge_fs_upgrade_files",
    "reconcile_knowledge_fs_upgrade_documents",
    "recover_stalled_knowledge_fs_upgrades",
    "run_knowledge_fs_upgrade",
]
