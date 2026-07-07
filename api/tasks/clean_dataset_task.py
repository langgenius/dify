import logging
import time
from collections.abc import Callable, Sequence

import click
from celery import shared_task
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_storage import storage
from models import WorkflowType
from models.dataset import (
    AppDatasetJoin,
    ChildChunk,
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment,
    Pipeline,
    SegmentAttachmentBinding,
)
from models.model import UploadFile
from models.workflow import Workflow

logger = logging.getLogger(__name__)

# The dataset row is already gone by the time this task runs, so if the cleanup
# fails there is nothing left to trigger a retry. Deleting everything in a single
# transaction meant one timeout/deadlock (e.g. on a multi-million-row dataset, or
# a lock held by indexing that was still running at delete time) rolled the whole
# task back and orphaned the documents, segments, child chunks and the vector
# index forever. Instead: clean each concern independently and commit as we go, so
# a failure in one step neither rolls back finished work nor skips the later steps,
# and delete the large child tables in bounded batches.
_DELETE_BATCH_SIZE = 1000


@shared_task(queue="dataset")
def clean_dataset_task(
    dataset_id: str,
    tenant_id: str,
    indexing_technique: str,
    index_struct: str,
    collection_binding_id: str,
    doc_form: str,
    pipeline_id: str | None = None,
):
    """
    Clean dataset when dataset deleted.
    :param dataset_id: dataset id
    :param tenant_id: tenant id
    :param indexing_technique: indexing technique
    :param index_struct: index struct dict
    :param collection_binding_id: collection binding id
    :param doc_form: dataset form

    Usage: clean_dataset_task.delay(dataset_id, tenant_id, indexing_technique, index_struct)
    """
    logger.info(click.style(f"Start clean dataset when dataset deleted: {dataset_id}", fg="green"))
    start_at = time.perf_counter()

    # Treat None / empty / whitespace-only doc_form as the default paragraph index
    # type so the vector database can still be cleaned up.
    if doc_form is None or (isinstance(doc_form, str) and not doc_form.strip()):
        from core.rag.index_processor.constant.index_type import IndexStructureType

        doc_form = IndexStructureType.PARAGRAPH_INDEX
        logger.info(
            click.style(f"Invalid doc_form detected, using default index type for cleanup: {doc_form}", fg="yellow")
        )

    # Vector store / keyword index cleanup, isolated from the relational cleanup so a
    # failure on either side does not prevent the other.
    try:
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=indexing_technique,
            index_struct=index_struct,
            collection_binding_id=collection_binding_id,
        )
        index_processor = IndexProcessorFactory(doc_form).init_index_processor()
        index_processor.clean(dataset, None, with_keywords=True, delete_child_chunks=True)
        logger.info(click.style(f"Successfully cleaned vector database for dataset: {dataset_id}", fg="green"))
    except Exception:
        logger.exception(click.style(f"Failed to clean vector database for dataset {dataset_id}", fg="red"))
        logger.info(
            click.style(f"Continuing with document and segment deletion for dataset: {dataset_id}", fg="yellow")
        )

    with session_factory.create_session() as session:
        try:
            # Order matters: segments before documents; child chunks are a fallback in
            # case the vector cleanup above did not remove them.
            _run_step(session, dataset_id, "segments", lambda: _delete_segments(session, dataset_id))
            _run_step(
                session,
                dataset_id,
                "child chunks",
                lambda: _delete_in_batches(session, ChildChunk, ChildChunk.dataset_id == dataset_id),
            )
            _run_step(session, dataset_id, "documents", lambda: _delete_documents(session, dataset_id))
            _run_step(session, dataset_id, "attachments", lambda: _delete_attachments(session, dataset_id, tenant_id))
            _run_step(
                session,
                dataset_id,
                "dataset metadata",
                lambda: _delete_dataset_scoped_rows(session, dataset_id, tenant_id, pipeline_id),
            )
            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Cleaned dataset when dataset deleted: {dataset_id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
        finally:
            try:
                session.close()
            except Exception:
                logger.exception("Failed to close database session")


def _run_step(session: Session, dataset_id: str, name: str, step: Callable[[], None]) -> None:
    """Run one cleanup step in isolation: a failure is logged and the (partial,
    uncommitted) work is rolled back, but the remaining steps still run."""
    try:
        step()
    except Exception:
        logger.exception(click.style(f"Failed to clean {name} for dataset {dataset_id}", fg="red"))
        try:
            session.rollback()
        except Exception:
            logger.exception("Failed to rollback database session")


def _delete_in_batches[Model](
    session: Session,
    model: type[Model],
    condition: ColumnElement[bool],
    batch_size: int = _DELETE_BATCH_SIZE,
) -> None:
    """Delete rows of ``model`` matching ``condition`` in bounded, individually
    committed batches."""
    while True:
        ids: Sequence[str] = session.scalars(select(model.id).where(condition).limit(batch_size)).all()  # type: ignore[attr-defined]
        if not ids:
            break
        session.execute(delete(model).where(model.id.in_(ids)))  # type: ignore[attr-defined]
        session.commit()


def _delete_segments(session: Session, dataset_id: str, batch_size: int = _DELETE_BATCH_SIZE) -> None:
    """Delete document segments in batches, removing their inline image files first."""
    while True:
        segments = session.scalars(
            select(DocumentSegment).where(DocumentSegment.dataset_id == dataset_id).limit(batch_size)
        ).all()
        if not segments:
            break
        image_upload_file_ids: list[str] = []
        for segment in segments:
            image_upload_file_ids.extend(get_image_upload_file_ids(segment.content))
        _delete_upload_files(session, image_upload_file_ids)
        session.execute(delete(DocumentSegment).where(DocumentSegment.id.in_([s.id for s in segments])))
        session.commit()


def _delete_documents(session: Session, dataset_id: str, batch_size: int = _DELETE_BATCH_SIZE) -> None:
    """Delete documents in batches, removing their uploaded source files first."""
    while True:
        documents = session.scalars(
            select(Document).where(Document.dataset_id == dataset_id).limit(batch_size)
        ).all()
        if not documents:
            break
        file_ids: list[str] = []
        for document in documents:
            if document.data_source_type == "upload_file" and document.data_source_info:
                data_source_info = document.data_source_info_dict
                if data_source_info and "upload_file_id" in data_source_info:
                    file_ids.append(data_source_info["upload_file_id"])
        _delete_upload_files(session, file_ids)
        session.execute(delete(Document).where(Document.id.in_([d.id for d in documents])))
        session.commit()


def _delete_upload_files(session: Session, file_ids: Sequence[str]) -> None:
    """Delete ``UploadFile`` rows and their object-storage blobs. Storage errors are
    logged but do not keep the row: the dataset is already gone, so leaving the row
    would orphan it forever (a stray blob can be reclaimed by storage GC instead)."""
    if not file_ids:
        return
    files = session.scalars(select(UploadFile).where(UploadFile.id.in_(file_ids))).all()
    for file in files:
        try:
            storage.delete(file.key)
        except Exception:
            logger.exception("Delete file failed when storage deleted, upload_file_id: %s", file.id)
    session.execute(delete(UploadFile).where(UploadFile.id.in_(file_ids)))


def _delete_attachments(session: Session, dataset_id: str, tenant_id: str) -> None:
    """Delete segment attachments (upload files + bindings) for the dataset."""
    attachments_with_bindings = session.execute(
        select(SegmentAttachmentBinding, UploadFile)
        .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
        .where(
            SegmentAttachmentBinding.tenant_id == tenant_id,
            SegmentAttachmentBinding.dataset_id == dataset_id,
        )
    ).all()
    if not attachments_with_bindings:
        return
    attachment_ids = [attachment_file.id for _, attachment_file in attachments_with_bindings]
    binding_ids = [binding.id for binding, _ in attachments_with_bindings]
    for binding, attachment_file in attachments_with_bindings:
        try:
            storage.delete(attachment_file.key)
        except Exception:
            logger.exception(
                "Delete attachment_file failed when storage deleted, attachment_file_id: %s",
                binding.attachment_id,
            )
    session.execute(delete(UploadFile).where(UploadFile.id.in_(attachment_ids)))
    session.execute(delete(SegmentAttachmentBinding).where(SegmentAttachmentBinding.id.in_(binding_ids)))
    session.commit()


def _delete_dataset_scoped_rows(
    session: Session, dataset_id: str, tenant_id: str, pipeline_id: str | None
) -> None:
    """Delete the remaining small dataset-scoped tables (and the pipeline/workflow)."""
    session.execute(delete(DatasetProcessRule).where(DatasetProcessRule.dataset_id == dataset_id))
    session.execute(delete(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id))
    session.execute(delete(AppDatasetJoin).where(AppDatasetJoin.dataset_id == dataset_id))
    session.execute(delete(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset_id))
    session.execute(delete(DatasetMetadataBinding).where(DatasetMetadataBinding.dataset_id == dataset_id))
    if pipeline_id:
        session.execute(delete(Pipeline).where(Pipeline.id == pipeline_id))
        session.execute(
            delete(Workflow).where(
                Workflow.tenant_id == tenant_id,
                Workflow.app_id == pipeline_id,
                Workflow.type == WorkflowType.RAG_PIPELINE,
            )
        )
    session.commit()
