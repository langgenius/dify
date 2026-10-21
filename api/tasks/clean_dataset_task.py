"""Reliably remove the persisted and external resources of a deleted dataset."""

import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from itertools import batched

import click
from celery import shared_task
from celery.exceptions import Reject
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models import WorkflowType
from models.dataset import (
    AppDatasetJoin,
    ChildChunk,
    Dataset,
    DatasetAutoDisableLog,
    DatasetKeywordTable,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentPipelineExecutionLog,
    DocumentSegment,
    DocumentSegmentSummary,
    ExternalKnowledgeBindings,
    Pipeline,
)
from models.enums import TagType
from models.model import Tag, TagBinding
from models.workflow import Workflow
from repositories.knowledge.dataset_repository import build_dataset_cleanup_manifest
from repositories.knowledge.upload_file_repository import (
    claim_orphan_upload_files,
    delete_orphan_upload_files,
    detach_orphan_segment_attachments,
    recheck_claimed_orphan_upload_files,
    remove_document_upload_file_references,
)
from services.dataset_storage_cleanup_service import cleanup_dataset_crawl_cache
from services.knowledge.indexing.adapters.cleanup import build_deletion_index_cleanup
from services.knowledge.indexing.cleanup import (
    DocumentCleanupManifest,
    UploadFileCleanup,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError
from tasks.clean_upload_files_task import (
    defer_started_upload_file_cleanup_if_disabled,
    defer_upload_file_cleanup_if_disabled,
)
from tasks.cleanup_knowledge_index_task import enqueue_deletion_index_cleanup
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)
_DELETE_BATCH_SIZE = 1000


@dataclass(frozen=True)
class DatasetCleanupInputs:
    document_ids: tuple[str, ...]
    segment_ids: tuple[str, ...]
    files: DocumentCleanupManifest


def _string_tuple(payload: Mapping[str, object], key: str) -> tuple[str, ...]:
    value = payload.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"dataset cleanup manifest field {key} must be a string list")
    return tuple(dict.fromkeys(value))


def _parse_manifest(payload: Mapping[str, object]) -> DatasetCleanupInputs:
    return DatasetCleanupInputs(
        document_ids=_string_tuple(payload, "document_ids"),
        segment_ids=_string_tuple(payload, "segment_ids"),
        files=DocumentCleanupManifest.from_payload(payload),
    )


def _snapshot_remaining_dataset_files(*, tenant_id: str, dataset_id: str) -> dict[str, object]:
    """Snapshot still-present rows for direct callers predating the durable payload."""

    with session_factory.create_session() as session:
        return build_dataset_cleanup_manifest(session, tenant_id=tenant_id, dataset_id=dataset_id)


def _storage_delete(
    files: Sequence[UploadFileCleanup],
    *,
    assert_cleanup_allowed: Callable[[], None] = lambda: None,
) -> None:
    """Delete storage objects idempotently while preserving other failures for retry."""

    keys = dict.fromkeys(file.key for file in files if file.key)
    for key in keys:
        assert_cleanup_allowed()
        try:
            storage.delete(key)
        except FileNotFoundError:
            continue
        except Exception:
            logger.exception("Failed to delete dataset file from storage, key=%s", key)
            raise


def _prepare_relational_cleanup(
    *,
    tenant_id: str,
    dataset_id: str,
    inputs: DatasetCleanupInputs,
    files: DocumentCleanupManifest,
) -> tuple[UploadFileCleanup, ...]:
    """Detach file edges and durably fence orphan files before storage I/O."""

    with session_factory.create_session() as session, session.begin():
        attachment_files = detach_orphan_segment_attachments(
            session,
            tenant_id=tenant_id,
            attachments=files.segment_attachments,
        )
        remove_document_upload_file_references(
            session,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=inputs.document_ids,
        )
        session.flush()
        claimed_files = claim_orphan_upload_files(
            session,
            tenant_id=tenant_id,
            files=(
                *files.document_files,
                *files.image_files,
                *attachment_files,
            ),
            excluding_dataset_ids=(dataset_id,),
        )
        return claimed_files


def _clean_relational_rows(
    *,
    tenant_id: str,
    dataset_id: str,
    pipeline_id: str | None,
    inputs: DatasetCleanupInputs,
    files: Sequence[UploadFileCleanup],
    assert_owned: Callable[[], None] = lambda: None,
) -> None:
    """Finish scoped SQL cleanup in replayable, bounded transactions."""

    assert_owned()
    with session_factory.create_session() as session, session.begin():
        session.execute(
            delete(DocumentSegmentSummary).where(
                DocumentSegmentSummary.dataset_id == dataset_id,
                DocumentSegmentSummary.document_id.in_(inputs.document_ids),
            )
        )
        session.execute(
            delete(ChildChunk).where(
                ChildChunk.tenant_id == tenant_id,
                ChildChunk.dataset_id == dataset_id,
            )
        )

    _delete_segments(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        segment_ids=inputs.segment_ids,
        assert_owned=assert_owned,
    )
    _delete_documents(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=inputs.document_ids,
        assert_owned=assert_owned,
    )

    assert_owned()
    with session_factory.create_session() as session, session.begin():
        delete_orphan_upload_files(session, tenant_id=tenant_id, files=files)
        session.execute(delete(DatasetProcessRule).where(DatasetProcessRule.dataset_id == dataset_id))
        session.execute(delete(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id))
        session.execute(delete(DatasetKeywordTable).where(DatasetKeywordTable.dataset_id == dataset_id))
        session.execute(
            delete(DatasetAutoDisableLog).where(
                DatasetAutoDisableLog.tenant_id == tenant_id,
                DatasetAutoDisableLog.dataset_id == dataset_id,
            )
        )
        session.execute(
            delete(ExternalKnowledgeBindings).where(
                ExternalKnowledgeBindings.tenant_id == tenant_id,
                ExternalKnowledgeBindings.dataset_id == dataset_id,
            )
        )
        knowledge_tag_ids = select(Tag.id).where(
            Tag.tenant_id == tenant_id,
            Tag.type == TagType.KNOWLEDGE,
        )
        session.execute(
            delete(TagBinding).where(
                TagBinding.tenant_id == tenant_id,
                TagBinding.target_id == dataset_id,
                TagBinding.tag_id.in_(knowledge_tag_ids),
            )
        )
        session.execute(delete(AppDatasetJoin).where(AppDatasetJoin.dataset_id == dataset_id))
        session.execute(
            delete(DatasetMetadata).where(
                DatasetMetadata.tenant_id == tenant_id,
                DatasetMetadata.dataset_id == dataset_id,
            )
        )
        session.execute(
            delete(DatasetMetadataBinding).where(
                DatasetMetadataBinding.tenant_id == tenant_id,
                DatasetMetadataBinding.dataset_id == dataset_id,
            )
        )
        if pipeline_id:
            session.execute(delete(Pipeline).where(Pipeline.tenant_id == tenant_id, Pipeline.id == pipeline_id))
            session.execute(
                delete(Workflow).where(
                    Workflow.tenant_id == tenant_id,
                    Workflow.app_id == pipeline_id,
                    Workflow.type == WorkflowType.RAG_PIPELINE,
                )
            )


def _delete_segments(
    *,
    tenant_id: str,
    dataset_id: str,
    segment_ids: Sequence[str],
    assert_owned: Callable[[], None],
) -> None:
    """Delete manifest segments in bounded commits so retries resume remaining rows."""

    for segment_batch in batched(segment_ids, _DELETE_BATCH_SIZE, strict=False):
        assert_owned()
        with session_factory.create_session() as session, session.begin():
            session.execute(
                delete(DocumentSegment).where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.id.in_(segment_batch),
                )
            )


def _delete_documents(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    assert_owned: Callable[[], None],
) -> None:
    """Delete manifest documents and their execution logs in bounded commits."""

    for document_batch in batched(document_ids, _DELETE_BATCH_SIZE, strict=False):
        assert_owned()
        with session_factory.create_session() as session, session.begin():
            session.execute(
                delete(DocumentPipelineExecutionLog).where(
                    DocumentPipelineExecutionLog.document_id.in_(document_batch),
                )
            )
            session.execute(
                delete(Document).where(
                    Document.tenant_id == tenant_id,
                    Document.dataset_id == dataset_id,
                    Document.id.in_(document_batch),
                )
            )


def _clean_dataset(
    *,
    dataset_id: str,
    tenant_id: str,
    indexing_technique: str | None,
    index_struct: str | None,
    collection_binding_id: str | None,
    doc_form: str | None,
    pipeline_id: str | None = None,
    manifest: Mapping[str, object] | None = None,
    embedding_model_provider: str | None = None,
    embedding_model: str | None = None,
    source_outbox_id: str | None = None,
    assert_owned: Callable[[], None] = lambda: None,
    assert_cleanup_allowed: Callable[[], None] = lambda: None,
) -> None:
    """Clean a deleted dataset from a durable, tenant-scoped snapshot."""

    cleanup_inputs = _parse_manifest(
        manifest
        if manifest is not None
        else _snapshot_remaining_dataset_files(tenant_id=tenant_id, dataset_id=dataset_id)
    )

    cleanup_dataset_crawl_cache(
        tenant_id,
        dataset_id,
        assert_cleanup_allowed=assert_cleanup_allowed,
    )

    with session_factory.create_session() as session, session.begin():
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name="deleted dataset",
            provider="vendor",
            created_by=tenant_id,
            indexing_technique=indexing_technique,
            index_struct=index_struct,
            collection_binding_id=collection_binding_id,
            embedding_model_provider=embedding_model_provider,
            embedding_model=embedding_model,
        )
        index_cleanup = build_deletion_index_cleanup(
            session,
            dataset=dataset,
            delete_all=True,
            refresh_billing=True,
        )
        enqueue_deletion_index_cleanup(
            session,
            cleanup=index_cleanup,
            source_outbox_id=source_outbox_id,
        )

    assert_owned()
    claimed_files = _prepare_relational_cleanup(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        inputs=cleanup_inputs,
        files=cleanup_inputs.files,
    )
    assert_owned()
    with session_factory.create_session() as session, session.begin():
        claimed_files = recheck_claimed_orphan_upload_files(
            session,
            tenant_id=tenant_id,
            files=claimed_files,
            excluding_dataset_ids=(dataset_id,),
        )
    assert_owned()
    _storage_delete(claimed_files, assert_cleanup_allowed=assert_cleanup_allowed)
    assert_owned()
    _clean_relational_rows(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        pipeline_id=pipeline_id,
        inputs=cleanup_inputs,
        files=claimed_files,
        assert_owned=assert_owned,
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
def clean_dataset_task(
    dataset_id: str,
    tenant_id: str,
    indexing_technique: str | None,
    index_struct: str | None,
    collection_binding_id: str | None,
    doc_form: str | None,
    pipeline_id: str | None = None,
    manifest: Mapping[str, object] | None = None,
    outbox_id: str | None = None,
    embedding_model_provider: str | None = None,
    embedding_model: str | None = None,
) -> None:
    """Run retryable cleanup for one deleted dataset."""

    logger.info(click.style(f"Start clean dataset when dataset deleted: {dataset_id}", fg="green"))
    start_at = time.perf_counter()
    if defer_upload_file_cleanup_if_disabled(outbox_id):
        return
    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        _clean_dataset(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=indexing_technique,
            index_struct=index_struct,
            collection_binding_id=collection_binding_id,
            doc_form=doc_form,
            pipeline_id=pipeline_id,
            manifest=manifest,
            embedding_model_provider=embedding_model_provider,
            embedding_model=embedding_model,
            source_outbox_id=outbox_id,
            assert_owned=execution.assert_owned,
            assert_cleanup_allowed=lambda: defer_started_upload_file_cleanup_if_disabled(
                execution,
                outbox_id=outbox_id,
            ),
        )
    logger.info(
        click.style(
            f"Cleaned dataset when dataset deleted: {dataset_id} latency: {time.perf_counter() - start_at}",
            fg="green",
        )
    )
