"""Remove the persisted and external resources of a deleted dataset."""

import logging
import time
from collections.abc import Callable, Sequence

import click
from celery import shared_task
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
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
    DatasetPermission,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentPipelineExecutionLog,
    DocumentSegment,
    DocumentSegmentSummary,
    ExternalKnowledgeBindings,
    Pipeline,
    SegmentAttachmentBinding,
)
from models.enums import TagType
from models.model import Tag, TagBinding
from models.workflow import Workflow
from repositories.file.upload_file_repository import UploadFileRepository
from services.dataset_knowledge_fs_upgrade_file_lease import reserve_upgrade_file_cleanup
from services.dataset_storage_cleanup_service import cleanup_dataset_crawl_cache
from services.file_adapters import build_upload_file_reclaimer
from services.file_reference_parser import trusted_upload_file_ids
from services.knowledge.indexing.contracts import pending_upload_cleanup_ids
from tasks.refresh_billing_vector_space_task import schedule_billing_vector_space_refresh

logger = logging.getLogger(__name__)

_DELETE_BATCH_SIZE = 1000
_MAX_RETRIES = 3
_RETRY_DELAY_SECONDS = 30


def _delete_unreferenced_files_in_session(
    session: Session,
    *,
    tenant_id: str,
    file_ids: Sequence[str],
) -> None:
    """Stage file removal under its lock; blobs are deleted after SQL commit."""

    leased_file_ids = reserve_upgrade_file_cleanup(session, file_ids)
    session_maker = session_factory.get_session_maker()
    files = UploadFileRepository(session_factory=session_maker)
    reclaimer = build_upload_file_reclaimer(session_factory=session_maker, files=files)
    reclaimer.delete_unreferenced_files_in_session(
        session,
        tenant_id=tenant_id,
        file_ids=(file_id for file_id in file_ids if file_id not in leased_file_ids),
        delete_blob=storage.delete,
    )


def _clean_index(session: Session, dataset: Dataset, doc_form: str) -> None:
    index_processor = IndexProcessorFactory(doc_form).init_index_processor()
    # Child content remains the durable candidate evidence for file cleanup.
    index_processor.clean(dataset, None, with_keywords=True, delete_child_chunks=False, session=session)
    session.commit()
    logger.info(click.style(f"Successfully cleaned vector database for dataset: {dataset.id}", fg="green"))


def _delete_child_chunks(*, tenant_id: str, dataset_id: str) -> None:
    """Reclaim child-only files, including children whose segment is gone."""

    while True:
        with session_factory.create_session() as session, session.begin():
            children = session.scalars(
                select(ChildChunk)
                .where(ChildChunk.tenant_id == tenant_id, ChildChunk.dataset_id == dataset_id)
                .order_by(ChildChunk.id)
                .limit(_DELETE_BATCH_SIZE)
            ).all()
            if not children:
                return
            child_ids = tuple(child.id for child in children)
            file_ids = tuple(
                file_id for child in children for file_id in sorted(trusted_upload_file_ids(child.content))
            )
            session.execute(
                delete(ChildChunk).where(
                    ChildChunk.tenant_id == tenant_id,
                    ChildChunk.dataset_id == dataset_id,
                    ChildChunk.id.in_(child_ids),
                )
            )
            session.flush()
            _delete_unreferenced_files_in_session(session, tenant_id=tenant_id, file_ids=file_ids)


def _delete_segments(*, tenant_id: str, dataset_id: str) -> None:
    """Delete segment batches and reclaim only globally unreferenced files."""

    while True:
        with session_factory.create_session() as session, session.begin():
            segments = session.scalars(
                select(DocumentSegment)
                .where(DocumentSegment.tenant_id == tenant_id, DocumentSegment.dataset_id == dataset_id)
                .order_by(DocumentSegment.id)
                .limit(_DELETE_BATCH_SIZE)
            ).all()
            if not segments:
                return

            segment_ids = tuple(segment.id for segment in segments)
            file_ids = [
                file_id
                for segment in segments
                for content in (segment.content, segment.answer)
                if content
                for file_id in sorted(trusted_upload_file_ids(content))
            ]
            file_ids.extend(
                session.scalars(
                    select(SegmentAttachmentBinding.attachment_id).where(
                        SegmentAttachmentBinding.tenant_id == tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset_id,
                        SegmentAttachmentBinding.segment_id.in_(segment_ids),
                    )
                ).all()
            )

            session.execute(
                delete(SegmentAttachmentBinding).where(
                    SegmentAttachmentBinding.tenant_id == tenant_id,
                    SegmentAttachmentBinding.dataset_id == dataset_id,
                    SegmentAttachmentBinding.segment_id.in_(segment_ids),
                )
            )
            session.execute(
                delete(DocumentSegmentSummary).where(
                    DocumentSegmentSummary.dataset_id == dataset_id,
                    DocumentSegmentSummary.chunk_id.in_(segment_ids),
                )
            )
            session.execute(
                delete(DocumentSegment).where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.id.in_(segment_ids),
                )
            )
            session.flush()
            _delete_unreferenced_files_in_session(session, tenant_id=tenant_id, file_ids=file_ids)


def _delete_documents(*, tenant_id: str, dataset_id: str) -> None:
    """Delete document batches and reclaim only globally unreferenced source files."""

    while True:
        with session_factory.create_session() as session, session.begin():
            documents = session.scalars(
                select(Document)
                .where(Document.tenant_id == tenant_id, Document.dataset_id == dataset_id)
                .order_by(Document.id)
                .limit(_DELETE_BATCH_SIZE)
            ).all()
            if not documents:
                return

            document_ids = tuple(document.id for document in documents)
            file_ids: list[str] = []
            for document in documents:
                source_info = document.data_source_info_dict
                file_ids.extend(pending_upload_cleanup_ids(source_info))
                file_id = source_info.get("upload_file_id")
                if isinstance(file_id, str):
                    file_ids.append(file_id)

            session.execute(
                delete(DatasetMetadataBinding).where(
                    DatasetMetadataBinding.tenant_id == tenant_id,
                    DatasetMetadataBinding.dataset_id == dataset_id,
                    DatasetMetadataBinding.document_id.in_(document_ids),
                )
            )
            session.execute(
                delete(DatasetAutoDisableLog).where(
                    DatasetAutoDisableLog.tenant_id == tenant_id,
                    DatasetAutoDisableLog.dataset_id == dataset_id,
                    DatasetAutoDisableLog.document_id.in_(document_ids),
                )
            )
            session.execute(
                delete(DocumentPipelineExecutionLog).where(DocumentPipelineExecutionLog.document_id.in_(document_ids))
            )
            session.execute(
                delete(Document).where(
                    Document.tenant_id == tenant_id,
                    Document.dataset_id == dataset_id,
                    Document.id.in_(document_ids),
                )
            )
            session.flush()
            _delete_unreferenced_files_in_session(session, tenant_id=tenant_id, file_ids=file_ids)


def _delete_remaining_attachments(*, tenant_id: str, dataset_id: str) -> None:
    """Remove orphan binding rows that no longer have a matching segment."""

    while True:
        with session_factory.create_session() as session, session.begin():
            bindings = session.scalars(
                select(SegmentAttachmentBinding)
                .where(
                    SegmentAttachmentBinding.tenant_id == tenant_id,
                    SegmentAttachmentBinding.dataset_id == dataset_id,
                )
                .order_by(SegmentAttachmentBinding.id)
                .limit(_DELETE_BATCH_SIZE)
            ).all()
            if not bindings:
                return
            binding_ids = tuple(binding.id for binding in bindings)
            attachment_ids = tuple(binding.attachment_id for binding in bindings)
            session.execute(delete(SegmentAttachmentBinding).where(SegmentAttachmentBinding.id.in_(binding_ids)))
            session.flush()
            _delete_unreferenced_files_in_session(session, tenant_id=tenant_id, file_ids=attachment_ids)


def _delete_dataset_scoped_rows(*, tenant_id: str, dataset_id: str, pipeline_id: str | None) -> None:
    """Delete the remaining tenant-scoped relation rows."""

    with session_factory.create_session() as session, session.begin():
        session.execute(delete(DocumentSegmentSummary).where(DocumentSegmentSummary.dataset_id == dataset_id))
        session.execute(
            delete(ChildChunk).where(ChildChunk.tenant_id == tenant_id, ChildChunk.dataset_id == dataset_id)
        )
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
        session.execute(
            delete(DatasetPermission).where(
                DatasetPermission.tenant_id == tenant_id,
                DatasetPermission.dataset_id == dataset_id,
            )
        )
        knowledge_tag_ids = select(Tag.id).where(Tag.tenant_id == tenant_id, Tag.type == TagType.KNOWLEDGE)
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


def _run_step(dataset_id: str, name: str, step: Callable[[], None]) -> None:
    try:
        step()
    except Exception:
        logger.exception(click.style(f"Failed to clean {name} for dataset {dataset_id}", fg="red"))
        raise


@shared_task(
    queue="dataset",
    bind=True,
    max_retries=_MAX_RETRIES,
    default_retry_delay=_RETRY_DELAY_SECONDS,
    acks_late=True,
    reject_on_worker_lost=True,
)
def clean_dataset_task(
    self,
    dataset_id: str,
    tenant_id: str,
    indexing_technique: str | None,
    index_struct: str | None,
    collection_binding_id: str | None,
    doc_form: str | None,
    pipeline_id: str | None = None,
    *,
    index_cleanup_done: bool = False,
) -> None:
    """Clean a deleted dataset using the original Celery message contract."""

    logger.info(click.style(f"Start clean dataset when dataset deleted: {dataset_id}", fg="green"))
    start_at = time.perf_counter()
    if not doc_form or not doc_form.strip():
        doc_form = "text_model"
        logger.info(click.style(f"Invalid doc_form; using {doc_form} for cleanup", fg="yellow"))

    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        indexing_technique=indexing_technique,
        index_struct=index_struct,
        collection_binding_id=collection_binding_id,
    )

    try:
        cleanup_dataset_crawl_cache(tenant_id, dataset_id)
        if not index_cleanup_done:
            if indexing_technique:
                with session_factory.create_session() as session:
                    _run_step(dataset_id, "dataset index", lambda: _clean_index(session, dataset, doc_form))
                schedule_billing_vector_space_refresh(tenant_id)
            else:
                logger.info(
                    "Skipping external index cleanup for dataset without indexing configuration: %s",
                    dataset_id,
                )
            index_cleanup_done = True

        _run_step(dataset_id, "children", lambda: _delete_child_chunks(tenant_id=tenant_id, dataset_id=dataset_id))
        _run_step(dataset_id, "segments", lambda: _delete_segments(tenant_id=tenant_id, dataset_id=dataset_id))
        _run_step(dataset_id, "documents", lambda: _delete_documents(tenant_id=tenant_id, dataset_id=dataset_id))
        _run_step(
            dataset_id,
            "attachments",
            lambda: _delete_remaining_attachments(tenant_id=tenant_id, dataset_id=dataset_id),
        )
        _run_step(
            dataset_id,
            "dataset metadata",
            lambda: _delete_dataset_scoped_rows(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                pipeline_id=pipeline_id,
            ),
        )
    except Exception as exc:
        if self.request.retries >= _MAX_RETRIES:
            logger.exception("Dataset cleanup retry budget exhausted, dataset_id=%s", dataset_id)
            raise
        logger.warning(
            "Dataset cleanup failed, scheduling retry %d/%d, dataset_id=%s",
            self.request.retries + 1,
            _MAX_RETRIES,
            dataset_id,
            exc_info=True,
        )
        raise self.retry(
            exc=exc,
            args=(),
            kwargs={
                "dataset_id": dataset_id,
                "tenant_id": tenant_id,
                "indexing_technique": indexing_technique,
                "index_struct": index_struct,
                "collection_binding_id": collection_binding_id,
                "doc_form": doc_form,
                "pipeline_id": pipeline_id,
                "index_cleanup_done": index_cleanup_done,
            },
            countdown=_RETRY_DELAY_SECONDS * (2**self.request.retries),
        ) from exc

    logger.info(
        click.style(
            f"Cleaned dataset when dataset deleted: {dataset_id} latency: {time.perf_counter() - start_at}",
            fg="green",
        )
    )
