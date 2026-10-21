import logging
import time
from collections.abc import Callable, Mapping, Sequence

import click
from celery import shared_task
from celery.exceptions import Reject
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetAutoDisableLog,
    DatasetMetadataBinding,
    Document,
    DocumentPipelineExecutionLog,
    DocumentSegment,
    DocumentSegmentSummary,
)
from repositories.knowledge.upload_file_repository import (
    build_document_cleanup_manifest,
    claim_orphan_upload_files,
    delete_orphan_upload_files,
    detach_orphan_segment_attachments,
    recheck_claimed_orphan_upload_files,
    remove_document_upload_file_references,
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
)
from tasks.cleanup_knowledge_index_task import enqueue_deletion_index_cleanup
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)


def _unique_files(files: Sequence[UploadFileCleanup]) -> tuple[UploadFileCleanup, ...]:
    return tuple({file.id: file for file in files}.values())


def _resolve_tenant_id(dataset_id: str, tenant_id: str | None) -> str:
    if tenant_id:
        return tenant_id
    with session_factory.create_session() as session:
        resolved = session.scalar(select(Dataset.tenant_id).where(Dataset.id == dataset_id).limit(1))
    if not resolved:
        raise ValueError("tenant_id is required after the dataset has been deleted")
    return resolved


def _resolve_manifest(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    file_ids: Sequence[str],
    cleanup_manifest: Mapping[str, object] | None,
) -> DocumentCleanupManifest:
    if cleanup_manifest is not None:
        return DocumentCleanupManifest.from_payload(cleanup_manifest)
    with session_factory.create_session() as session:
        return build_document_cleanup_manifest(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
            document_file_ids=file_ids,
        )


def _clean_documents(
    *,
    document_ids: Sequence[str],
    dataset_id: str,
    doc_form: str,
    file_ids: Sequence[str],
    tenant_id: str | None,
    cleanup_manifest: Mapping[str, object] | None,
    source_outbox_id: str | None = None,
    assert_owned: Callable[[], None] = lambda: None,
    assert_cleanup_allowed: Callable[[], None] = lambda: None,
) -> None:
    unique_document_ids = tuple(dict.fromkeys(document_ids))
    if not unique_document_ids:
        return
    if not doc_form:
        raise ValueError("doc_form is required")

    resolved_tenant_id = _resolve_tenant_id(dataset_id, tenant_id)
    manifest = _resolve_manifest(
        tenant_id=resolved_tenant_id,
        dataset_id=dataset_id,
        document_ids=unique_document_ids,
        file_ids=file_ids,
        cleanup_manifest=cleanup_manifest,
    )

    # Persist external index cleanup first, then let relational and file cleanup
    # finish independently of provider availability.
    with session_factory.create_session() as session, session.begin():
        dataset = session.scalar(
            select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == resolved_tenant_id).limit(1)
        )
        if dataset is not None:
            segment_ids = tuple(
                session.scalars(
                    select(DocumentSegment.id).where(
                        DocumentSegment.tenant_id == resolved_tenant_id,
                        DocumentSegment.dataset_id == dataset_id,
                        DocumentSegment.document_id.in_(unique_document_ids),
                    )
                ).all()
            )
            inline_image_node_ids, attachment_node_ids = filter_file_vector_ids_without_active_references(
                session,
                DatasetRef(resolved_tenant_id, dataset_id),
                inline_image_ids=tuple(file.id for file in manifest.image_files),
                attachment_ids=tuple(attachment.attachment_id for attachment in manifest.segment_attachments),
                excluding_segment_ids=segment_ids,
            )
            index_cleanup = build_deletion_index_cleanup(
                session,
                dataset=dataset,
                delete_all=False,
                segment_ids=segment_ids,
                inline_image_node_ids=inline_image_node_ids,
                attachment_node_ids=attachment_node_ids,
                refresh_billing=True,
            )
            enqueue_deletion_index_cleanup(
                session,
                cleanup=index_cleanup,
                source_outbox_id=source_outbox_id,
            )

    # Remove bindings before deciding whether an attachment is globally
    # orphaned. These rows are independent of the Dataset row, so the persisted
    # tenant snapshot remains sufficient after a concurrent dataset deletion.
    assert_owned()
    with session_factory.create_session() as session, session.begin():
        orphan_attachments = detach_orphan_segment_attachments(
            session,
            tenant_id=resolved_tenant_id,
            attachments=manifest.segment_attachments,
        )
        remove_document_upload_file_references(
            session,
            tenant_id=resolved_tenant_id,
            dataset_id=dataset_id,
            document_ids=unique_document_ids,
        )
        session.execute(
            delete(DatasetMetadataBinding).where(
                DatasetMetadataBinding.tenant_id == resolved_tenant_id,
                DatasetMetadataBinding.dataset_id == dataset_id,
                DatasetMetadataBinding.document_id.in_(unique_document_ids),
            )
        )
        session.execute(
            delete(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.document_id.in_(unique_document_ids),
            )
        )
        session.execute(
            delete(ChildChunk).where(
                ChildChunk.tenant_id == resolved_tenant_id,
                ChildChunk.dataset_id == dataset_id,
                ChildChunk.document_id.in_(unique_document_ids),
            )
        )
        session.execute(
            delete(DocumentSegment).where(
                DocumentSegment.tenant_id == resolved_tenant_id,
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id.in_(unique_document_ids),
            )
        )
        session.execute(
            delete(DocumentPipelineExecutionLog).where(
                DocumentPipelineExecutionLog.document_id.in_(unique_document_ids),
            )
        )
        session.execute(
            delete(DatasetAutoDisableLog).where(
                DatasetAutoDisableLog.tenant_id == resolved_tenant_id,
                DatasetAutoDisableLog.dataset_id == dataset_id,
                DatasetAutoDisableLog.document_id.in_(unique_document_ids),
            )
        )
        session.execute(
            delete(Document).where(
                Document.tenant_id == resolved_tenant_id,
                Document.dataset_id == dataset_id,
                Document.id.in_(unique_document_ids),
            )
        )
        session.flush()
        files_to_delete = claim_orphan_upload_files(
            session,
            tenant_id=resolved_tenant_id,
            files=_unique_files([*manifest.document_files, *manifest.image_files, *orphan_attachments]),
        )

    assert_owned()
    with session_factory.create_session() as session, session.begin():
        files_to_delete = recheck_claimed_orphan_upload_files(
            session,
            tenant_id=resolved_tenant_id,
            files=files_to_delete,
        )
    assert_owned()
    storage_keys = tuple(dict.fromkeys(file.key for file in files_to_delete if file.key))
    for storage_key in storage_keys:
        assert_cleanup_allowed()
        try:
            storage.delete(storage_key)
        except FileNotFoundError:
            continue

    # Keep UploadFile rows until storage succeeds. If this transaction fails,
    # retrying storage deletion is idempotent and the manifest still has keys.
    assert_owned()
    with session_factory.create_session() as session, session.begin():
        delete_orphan_upload_files(
            session,
            tenant_id=resolved_tenant_id,
            files=files_to_delete,
        )


@shared_task(
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError, Reject),
    acks_late=True,
    reject_on_worker_lost=True,
)
def clean_document_task(
    document_id: str,
    dataset_id: str,
    doc_form: str,
    file_id: str | None,
    tenant_id: str | None = None,
    cleanup_manifest: Mapping[str, object] | None = None,
    outbox_id: str | None = None,
) -> None:
    """Clean one deleted document from indexes, relational state, and storage."""

    logger.info(click.style(f"Start clean document when document deleted: {document_id}", fg="green"))
    start_at = time.perf_counter()
    if defer_upload_file_cleanup_if_disabled(outbox_id):
        return
    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        _clean_documents(
            document_ids=(document_id,),
            dataset_id=dataset_id,
            doc_form=doc_form,
            file_ids=(file_id,) if file_id else (),
            tenant_id=tenant_id,
            cleanup_manifest=cleanup_manifest,
            source_outbox_id=outbox_id,
            assert_owned=execution.assert_owned,
            assert_cleanup_allowed=lambda: defer_started_upload_file_cleanup_if_disabled(
                execution,
                outbox_id=outbox_id,
            ),
        )
    logger.info(
        click.style(
            f"Cleaned document when document deleted: {document_id} latency: {time.perf_counter() - start_at}",
            fg="green",
        )
    )
