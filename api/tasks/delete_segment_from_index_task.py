"""Durable external-index and file cleanup for deleted document segments."""

import logging
import time
from collections.abc import Callable, Mapping, Sequence

import click
from celery import shared_task
from celery.exceptions import Reject
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.dataset import Document, SegmentAttachmentBinding
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.upload_file_repository import (
    claim_orphan_upload_files,
    detach_orphan_segment_attachments,
    detach_segment_attachments_and_claim_files,
    remove_segment_upload_file_references,
)
from services.knowledge.indexing.adapters.cleanup import (
    build_deletion_index_cleanup,
    filter_file_vector_ids_without_active_references,
)
from services.knowledge.indexing.cleanup import DocumentCleanupManifest, UploadFileCleanup
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError
from tasks.clean_upload_files_task import (
    defer_started_upload_file_cleanup_if_disabled,
    defer_upload_file_cleanup_if_disabled,
    finish_claimed_upload_file_cleanup,
)
from tasks.cleanup_knowledge_index_task import enqueue_deletion_index_cleanup
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)


def _unique_files(files: Sequence[UploadFileCleanup]) -> tuple[UploadFileCleanup, ...]:
    return tuple({file.id: file for file in files}.values())


def _resolve_tenant_id(*, dataset_id: str, document_id: str, tenant_id: str | None) -> str | None:
    if tenant_id:
        return tenant_id
    with session_factory.create_session() as session:
        return session.scalar(
            select(Document.tenant_id).where(Document.id == document_id, Document.dataset_id == dataset_id).limit(1)
        )


def _persist_segment_index_cleanup(
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    index_node_ids: Sequence[str],
    segment_ids: Sequence[str],
    child_node_ids: Sequence[str],
    summary_node_ids: Sequence[str],
    manifest: DocumentCleanupManifest | None,
    source_outbox_id: str | None,
    require_legacy_document_state: bool,
) -> bool:
    """Persist segment index cleanup before the remaining SQL rows disappear."""

    with session_factory.create_session() as session, session.begin():
        dataset = lock_dataset_for_child_write(session, DatasetRef(tenant_id, dataset_id))
        if dataset is None:
            return False
        document = session.scalar(
            select(Document)
            .where(
                Document.id == document_id,
                Document.dataset_id == dataset_id,
                Document.tenant_id == tenant_id,
            )
            .with_for_update()
            .limit(1)
        )
        if require_legacy_document_state and (
            document is None or not document.enabled or document.archived or document.indexing_status != "completed"
        ):
            logger.info("Document not in valid state for legacy index cleanup, skipping")
            return False

        attachment_candidates = (
            tuple(attachment.attachment_id for attachment in manifest.segment_attachments)
            if manifest is not None
            else tuple(
                session.scalars(
                    select(SegmentAttachmentBinding.attachment_id).where(
                        SegmentAttachmentBinding.tenant_id == tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset_id,
                        SegmentAttachmentBinding.document_id == document_id,
                        SegmentAttachmentBinding.segment_id.in_(tuple(dict.fromkeys(segment_ids))),
                    )
                ).all()
            )
        )
        inline_image_node_ids, attachment_node_ids = filter_file_vector_ids_without_active_references(
            session,
            DatasetRef(tenant_id, dataset_id),
            inline_image_ids=() if manifest is None else tuple(file.id for file in manifest.image_files),
            attachment_ids=attachment_candidates,
            excluding_segment_ids=segment_ids,
        )
        index_cleanup = build_deletion_index_cleanup(
            session,
            dataset=dataset,
            delete_all=False,
            segment_ids=segment_ids,
            index_node_ids=index_node_ids,
            child_node_ids=child_node_ids,
            summary_node_ids=summary_node_ids,
            inline_image_node_ids=inline_image_node_ids,
            attachment_node_ids=attachment_node_ids,
        )
        enqueue_deletion_index_cleanup(
            session,
            cleanup=index_cleanup,
            source_outbox_id=source_outbox_id,
        )
        return True


def _claim_segment_files(
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    segment_ids: Sequence[str],
    manifest: DocumentCleanupManifest | None,
) -> tuple[UploadFileCleanup, ...]:
    with session_factory.create_session() as session, session.begin():
        remove_segment_upload_file_references(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            segment_ids=segment_ids,
        )
        if manifest is None:
            return detach_segment_attachments_and_claim_files(
                session,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                segment_ids=segment_ids,
            )
        attachment_files = detach_orphan_segment_attachments(
            session,
            tenant_id=tenant_id,
            attachments=manifest.segment_attachments,
        )
        session.flush()
        return claim_orphan_upload_files(
            session,
            tenant_id=tenant_id,
            files=_unique_files((*manifest.image_files, *attachment_files)),
        )


def _delete_segments(
    *,
    index_node_ids: Sequence[str],
    dataset_id: str,
    document_id: str,
    segment_ids: Sequence[str],
    child_node_ids: Sequence[str],
    summary_node_ids: Sequence[str] = (),
    tenant_id: str | None,
    cleanup_manifest: Mapping[str, object] | None,
    durable: bool,
    source_outbox_id: str | None = None,
    assert_owned: Callable[[], None] = lambda: None,
    assert_cleanup_allowed: Callable[[], None] = lambda: None,
) -> None:
    resolved_tenant_id = _resolve_tenant_id(
        dataset_id=dataset_id,
        document_id=document_id,
        tenant_id=tenant_id,
    )
    if resolved_tenant_id is None:
        logger.warning("Dataset %s has no resolvable tenant, skipping segment cleanup", dataset_id)
        return
    manifest = DocumentCleanupManifest.from_payload(cleanup_manifest) if cleanup_manifest is not None else None
    cleanup_persisted = _persist_segment_index_cleanup(
        tenant_id=resolved_tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        index_node_ids=index_node_ids,
        segment_ids=segment_ids,
        child_node_ids=child_node_ids,
        summary_node_ids=summary_node_ids,
        manifest=manifest,
        source_outbox_id=source_outbox_id,
        require_legacy_document_state=not durable,
    )
    if not cleanup_persisted and not durable:
        return

    assert_owned()
    claimed_files = _claim_segment_files(
        tenant_id=resolved_tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_ids=segment_ids,
        manifest=manifest,
    )
    assert_owned()
    finish_claimed_upload_file_cleanup(
        tenant_id=resolved_tenant_id,
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
def delete_segment_from_index_task(
    index_node_ids: list[str],
    dataset_id: str,
    document_id: str,
    segment_ids: list[str],
    child_node_ids: list[str] | None = None,
    tenant_id: str | None = None,
    cleanup_manifest: Mapping[str, object] | None = None,
    outbox_id: str | None = None,
    summary_node_ids: list[str] | None = None,
) -> None:
    """Remove deleted segment indexes and durably converge orphan file cleanup."""

    logger.info(click.style("Start delete segment cleanup", fg="green"))
    started_at = time.perf_counter()
    if defer_upload_file_cleanup_if_disabled(outbox_id):
        return
    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        _delete_segments(
            index_node_ids=index_node_ids,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_ids=segment_ids,
            child_node_ids=child_node_ids or (),
            summary_node_ids=summary_node_ids or (),
            tenant_id=tenant_id,
            cleanup_manifest=cleanup_manifest,
            durable=outbox_id is not None or cleanup_manifest is not None,
            source_outbox_id=outbox_id,
            assert_owned=execution.assert_owned,
            assert_cleanup_allowed=lambda: defer_started_upload_file_cleanup_if_disabled(
                execution,
                outbox_id=outbox_id,
            ),
        )
    logger.info(click.style(f"Deleted segment cleanup latency: {time.perf_counter() - started_at}", fg="green"))
