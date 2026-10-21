"""Durably finish storage cleanup for detached upload-file candidates."""

import logging
from collections.abc import Callable, Sequence

from celery import shared_task
from celery.exceptions import Reject

from configs import dify_config
from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from repositories.knowledge.upload_file_repository import (
    claim_orphan_upload_files,
    delete_orphan_upload_files,
    find_claimed_upload_files,
    recheck_claimed_orphan_upload_files,
)
from services.knowledge.file_cleanup_gate import (
    FilePhysicalCleanupDisabledError,
    assert_physical_file_cleanup_enabled,
    physical_file_cleanup_enabled,
)
from services.knowledge.indexing.cleanup import UploadFileCleanup
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from tasks.knowledge_task_outbox_task import defer_knowledge_task_before_execution, knowledge_task_execution

logger = logging.getLogger(__name__)


def defer_upload_file_cleanup_if_disabled(outbox_id: str | None) -> bool:
    """Defer a durable intent or requeue its original legacy delivery."""

    if physical_file_cleanup_enabled():
        return False
    if outbox_id is not None:
        deferred = defer_knowledge_task_before_execution(
            outbox_id,
            error="Upload-file physical cleanup is disabled by the deployment gate",
            delay=dify_config.UPLOAD_FILE_CLEANUP_DEFER_SECONDS,
        )
        if not deferred:
            logger.warning("Could not defer gated upload cleanup intent %s", outbox_id)
        return True
    raise Reject("Upload-file physical cleanup is disabled by the deployment gate", requeue=True)


def defer_started_upload_file_cleanup_if_disabled(
    execution: KnowledgeTaskExecutionLease,
    *,
    outbox_id: str | None,
) -> None:
    """Preserve the original delivery when the gate closes mid-run."""

    if physical_file_cleanup_enabled():
        return
    if outbox_id is None:
        raise Reject("Upload-file physical cleanup is disabled by the deployment gate", requeue=True)
    execution.defer(
        error="Upload-file physical cleanup is disabled by the deployment gate",
        delay_seconds=dify_config.UPLOAD_FILE_CLEANUP_DEFER_SECONDS,
    )


def finish_claimed_upload_file_cleanup(
    *,
    tenant_id: str,
    files: Sequence[UploadFileCleanup],
    assert_owned: Callable[[], None] = lambda: None,
    assert_cleanup_allowed: Callable[[], None] = assert_physical_file_cleanup_enabled,
) -> None:
    """Delete claimed storage objects and finalize their guarded database rows."""

    candidates = tuple({file.id: file for file in files}.values())
    if not candidates:
        return
    assert_cleanup_allowed()
    assert_owned()
    with session_factory.create_session() as session, session.begin():
        claimed_files = recheck_claimed_orphan_upload_files(
            session,
            tenant_id=tenant_id,
            files=candidates,
        )
    assert_owned()
    for file in claimed_files:
        if not file.key:
            continue
        assert_cleanup_allowed()
        try:
            storage.delete(file.key)
        except FileNotFoundError:
            continue
        except Exception:
            logger.exception("Failed to delete detached upload file from storage, file_id=%s", file.id)
            raise

    assert_owned()
    with session_factory.create_session() as session, session.begin():
        delete_orphan_upload_files(session, tenant_id=tenant_id, files=claimed_files)


def _clean_upload_files(
    *,
    tenant_id: str,
    file_ids: Sequence[str],
    assert_owned: Callable[[], None] = lambda: None,
    assert_cleanup_allowed: Callable[[], None] = assert_physical_file_cleanup_enabled,
) -> None:
    candidates = tuple(UploadFileCleanup(id=file_id, key=None) for file_id in dict.fromkeys(file_ids) if file_id)
    if not candidates:
        return

    with session_factory.create_session() as session, session.begin():
        claimed_files = claim_orphan_upload_files(session, tenant_id=tenant_id, files=candidates)
    assert_owned()
    finish_claimed_upload_file_cleanup(
        tenant_id=tenant_id,
        files=claimed_files,
        assert_owned=assert_owned,
        assert_cleanup_allowed=assert_cleanup_allowed,
    )


@shared_task(
    queue="dataset",
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError, Reject),
    retry_backoff=True,
    max_retries=5,
    acks_late=True,
    reject_on_worker_lost=True,
)
def clean_upload_files_task(file_ids: list[str], tenant_id: str, outbox_id: str | None = None) -> None:
    """Delete candidates only after current-reference checks confirm they remain orphaned."""

    if defer_upload_file_cleanup_if_disabled(outbox_id):
        return
    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        _clean_upload_files(
            tenant_id=tenant_id,
            file_ids=file_ids,
            assert_owned=execution.assert_owned,
            assert_cleanup_allowed=lambda: defer_started_upload_file_cleanup_if_disabled(
                execution,
                outbox_id=outbox_id,
            ),
        )


@shared_task(queue="dataset")
def recover_claimed_upload_file_cleanup_task() -> None:
    """Resume a bounded batch left after worker, storage, or finalize failure."""

    if not physical_file_cleanup_enabled():
        return
    with session_factory.create_session() as session:
        pending = find_claimed_upload_files(
            session,
            limit=dify_config.UPLOAD_FILE_CLEANUP_RECOVERY_BATCH_SIZE,
        )
    for tenant_id, file in pending:
        try:
            finish_claimed_upload_file_cleanup(
                tenant_id=tenant_id,
                files=(file,),
            )
        except FilePhysicalCleanupDisabledError:
            logger.info("Stopped claimed upload cleanup recovery because the deployment gate closed")
            return
        except Exception:
            logger.exception(
                "Claimed upload cleanup recovery failed; marker retained, tenant_id=%s file_id=%s",
                tenant_id,
                file.id,
            )
