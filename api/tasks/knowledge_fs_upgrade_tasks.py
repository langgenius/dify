"""Dedicated-queue execution for legacy Dataset upgrades."""

from __future__ import annotations

import logging

from celery import shared_task

from core.db.session_factory import session_factory
from services.dataset_knowledge_fs_upgrade_file_lease import cleanup_deferred_upgrade_files
from services.dataset_knowledge_fs_upgrade_service import (
    KnowledgeFSUpgradeDocumentReconciler,
    KnowledgeFSUpgradeNotReadyError,
    KnowledgeFSUpgradeRunner,
)

KNOWLEDGE_FS_UPGRADE_QUEUE = "knowledge_fs_upgrade"
logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    queue=KNOWLEDGE_FS_UPGRADE_QUEUE,
    max_retries=360,
    default_retry_delay=5,
)
def run_knowledge_fs_upgrade(self, *, job_id: str) -> None:
    """Run one checkpoint and enqueue the next only after it is committed."""

    runner = KnowledgeFSUpgradeRunner(session_factory.get_session_maker())
    try:
        has_more = runner.run_next(job_id=job_id, celery_task_id=self.request.id)
    except KnowledgeFSUpgradeNotReadyError as error:
        if self.request.retries >= self.max_retries:
            runner.fail(job_id=job_id, error=error)
            logger.exception(
                "KnowledgeFS Dataset upgrade exhausted provisioning retries",
                extra={"upgrade_job_id": job_id},
            )
            raise
        raise self.retry(exc=error)
    except Exception as error:
        runner.fail(job_id=job_id, error=error)
        logger.exception("KnowledgeFS Dataset upgrade failed", extra={"upgrade_job_id": job_id})
        raise
    if has_more:
        run_knowledge_fs_upgrade.apply_async(kwargs={"job_id": job_id})
    else:
        reconcile_knowledge_fs_upgrade_documents.apply_async(kwargs={"job_id": job_id})


@shared_task(
    bind=True,
    queue=KNOWLEDGE_FS_UPGRADE_QUEUE,
    max_retries=10_080,
    default_retry_delay=60,
)
def reconcile_knowledge_fs_upgrade_documents(self, *, job_id: str) -> None:
    """Eventually apply click-time metadata and availability without gating migration success."""

    reconciler = KnowledgeFSUpgradeDocumentReconciler(session_factory.get_session_maker())
    try:
        remaining = reconciler.reconcile(job_id=job_id)
    except Exception as error:
        logger.warning(
            "KnowledgeFS Dataset upgrade document reconciliation is not ready",
            extra={"upgrade_job_id": job_id},
            exc_info=True,
        )
        raise self.retry(exc=error)
    if remaining:
        raise self.retry(exc=KnowledgeFSUpgradeNotReadyError(f"{remaining} migrated documents are not visible yet"))


@shared_task(queue=KNOWLEDGE_FS_UPGRADE_QUEUE)
def cleanup_deferred_knowledge_fs_upgrade_files() -> int:
    """Delete orphaned source files after abandoned upgrade leases expire."""

    return cleanup_deferred_upgrade_files(session_factory.get_session_maker())


def enqueue_knowledge_fs_upgrade(*, job_id: str) -> str:
    result = run_knowledge_fs_upgrade.apply_async(kwargs={"job_id": job_id})
    return str(result.id)


__all__ = [
    "KNOWLEDGE_FS_UPGRADE_QUEUE",
    "cleanup_deferred_knowledge_fs_upgrade_files",
    "enqueue_knowledge_fs_upgrade",
    "reconcile_knowledge_fs_upgrade_documents",
    "run_knowledge_fs_upgrade",
]
