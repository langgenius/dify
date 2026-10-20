import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_storage import storage
from models import WorkflowType
from models.dataset import (
    AppDatasetJoin,
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
from services.dataset_storage_cleanup_service import cleanup_dataset_crawl_cache
from tasks.refresh_billing_vector_space_task import schedule_billing_vector_space_refresh

logger = logging.getLogger(__name__)

# Batch size for database operations to keep transactions short
BATCH_SIZE = 1000


def _batched_delete(model, ids: list[str], dataset_id: str, description: str) -> None:
    """Delete rows of ``model`` by id in batches, with a fresh short transaction per batch."""
    for i in range(0, len(ids), BATCH_SIZE):
        batch = ids[i : i + BATCH_SIZE]
        try:
            with session_factory.create_session() as session:
                session.execute(delete(model).where(model.id.in_(batch)))
                session.commit()
        except Exception:
            logger.exception(
                "Failed to delete %s batch %d-%d for dataset: %s",
                description,
                i,
                i + len(batch),
                dataset_id,
            )


# Add import statement for ValueError
@shared_task(queue="dataset")
def clean_dataset_task(
    dataset_id: str,
    tenant_id: str,
    indexing_technique: str | None,
    index_struct: str | None,
    collection_binding_id: str | None,
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
    vector_cleanup_succeeded = False
    dataset_tenant_id = tenant_id

    cleanup_dataset_crawl_cache(tenant_id, dataset_id)

    documents = []
    segments = []
    attachments_with_bindings = []
    document_ids: list[str] = []
    segment_ids: list[str] = []
    image_upload_file_ids: list[str] = []
    attachment_ids: list[str] = []
    binding_ids: list[str] = []
    file_ids: list[str] = []
    storage_keys_to_delete: list[str] = []

    try:
        # ============ Step 1: read data + vector cleanup (single short transaction) ============
        with session_factory.create_session() as session:
            try:
                dataset = Dataset(
                    id=dataset_id,
                    tenant_id=tenant_id,
                    indexing_technique=indexing_technique,
                    index_struct=index_struct,
                    collection_binding_id=collection_binding_id,
                )
                documents = session.scalars(select(Document).where(Document.dataset_id == dataset_id)).all()
                segments = session.scalars(
                    select(DocumentSegment).where(DocumentSegment.dataset_id == dataset_id)
                ).all()
                # Use JOIN to fetch attachments with bindings in a single query
                attachments_with_bindings = session.execute(
                    select(SegmentAttachmentBinding, UploadFile)
                    .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                    .where(
                        SegmentAttachmentBinding.tenant_id == tenant_id,
                        SegmentAttachmentBinding.dataset_id == dataset_id,
                    )
                ).all()

                # Enhanced validation: Check if doc_form is None, empty string, or contains only whitespace
                # This ensures all invalid doc_form values are properly handled
                if doc_form is None or (isinstance(doc_form, str) and not doc_form.strip()):
                    # Use default paragraph index type for empty/invalid datasets to enable vector database cleanup
                    from core.rag.index_processor.constant.index_type import IndexStructureType

                    doc_form = IndexStructureType.PARAGRAPH_INDEX
                    logger.info(
                        click.style(
                            f"Invalid doc_form detected, using default index type for cleanup: {doc_form}",
                            fg="yellow",
                        )
                    )

                # Add exception handling around IndexProcessorFactory.clean() to prevent single point of failure
                # This ensures Document/Segment deletion can continue even if vector database cleanup fails
                try:
                    index_processor = IndexProcessorFactory(doc_form).init_index_processor()
                    index_processor.clean(dataset, None, with_keywords=True, delete_child_chunks=True, session=session)
                    vector_cleanup_succeeded = True
                    logger.info(
                        click.style(f"Successfully cleaned vector database for dataset: {dataset_id}", fg="green")
                    )
                except Exception:
                    logger.exception(click.style(f"Failed to clean vector database for dataset {dataset_id}", fg="red"))
                    # Continue with document and segment deletion even if vector cleanup fails
                    logger.info(
                        click.style(
                            f"Continuing with document and segment deletion for dataset: {dataset_id}", fg="yellow"
                        )
                    )

                document_ids = [document.id for document in documents]
                if documents:
                    segment_ids = [segment.id for segment in segments]
                    # Collect and dedupe image file ids across segments so datasets with
                    # many plain-text segments do not issue a SELECT/DELETE pair per segment
                    image_upload_file_ids = list(
                        dict.fromkeys(
                            image_id for segment in segments for image_id in get_image_upload_file_ids(segment.content)
                        )
                    )
                attachment_ids = [attachment_file.id for _, attachment_file in attachments_with_bindings]
                binding_ids = [binding.id for binding, _ in attachments_with_bindings]
                if documents:
                    for document in documents:
                        if document.data_source_type == "upload_file" and document.data_source_info:
                            data_source_info = document.data_source_info_dict
                            if data_source_info and "upload_file_id" in data_source_info:
                                file_ids.append(data_source_info["upload_file_id"])

                # Resolve storage keys while the rows are still readable, so the actual
                # storage deletion can run outside of any database transaction later
                if image_upload_file_ids:
                    image_files = session.scalars(
                        select(UploadFile).where(UploadFile.id.in_(image_upload_file_ids))
                    ).all()
                    storage_keys_to_delete.extend(
                        image_file.key for image_file in image_files if image_file is not None and image_file.key
                    )
                storage_keys_to_delete.extend(
                    attachment_file.key for _, attachment_file in attachments_with_bindings if attachment_file.key
                )
                if file_ids:
                    files = session.scalars(select(UploadFile).where(UploadFile.id.in_(file_ids))).all()
                    storage_keys_to_delete.extend(file.key for file in files if file is not None and file.key)

                dataset_tenant_id = dataset.tenant_id
                session.commit()
            except Exception:
                # Rollback to prevent dirty session state in case of exceptions
                # This ensures the database session is properly cleaned up
                try:
                    session.rollback()
                    logger.info(click.style(f"Rolled back database session for dataset: {dataset_id}", fg="yellow"))
                except Exception:
                    logger.exception("Failed to rollback database session")
                raise

        # ============ Step 2: batched deletes (multiple short transactions) ============
        if documents:
            if not document_ids:
                logger.info(click.style(f"No documents found for dataset: {dataset_id}", fg="green"))
            else:
                logger.info(click.style(f"Cleaning documents for dataset: {dataset_id}", fg="green"))
            _batched_delete(Document, document_ids, dataset_id, "Document")
            _batched_delete(DocumentSegment, segment_ids, dataset_id, "DocumentSegment")
            if image_upload_file_ids:
                _batched_delete(UploadFile, image_upload_file_ids, dataset_id, "image UploadFile")

        # delete segment attachments
        if attachments_with_bindings:
            try:
                with session_factory.create_session() as session:
                    session.execute(delete(UploadFile).where(UploadFile.id.in_(attachment_ids)))
                    session.execute(
                        delete(SegmentAttachmentBinding).where(SegmentAttachmentBinding.id.in_(binding_ids))
                    )
                    session.commit()
            except Exception:
                logger.exception("Failed to delete segment attachments for dataset: %s", dataset_id)

        try:
            with session_factory.create_session() as session:
                session.execute(delete(DatasetProcessRule).where(DatasetProcessRule.dataset_id == dataset_id))
                session.execute(delete(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id))
                session.execute(delete(AppDatasetJoin).where(AppDatasetJoin.dataset_id == dataset_id))
                # delete dataset metadata
                session.execute(delete(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset_id))
                session.execute(delete(DatasetMetadataBinding).where(DatasetMetadataBinding.dataset_id == dataset_id))
                # delete pipeline and workflow
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
        except Exception:
            logger.exception("Failed to delete dataset-scoped rows for dataset: %s", dataset_id)

        # delete files
        if file_ids:
            _batched_delete(UploadFile, file_ids, dataset_id, "document UploadFile")

        # ============ Step 3: storage deletion (I/O operations, no DB transaction) ============
        for storage_key in storage_keys_to_delete:
            try:
                storage.delete(storage_key)
            except Exception:
                logger.exception("Delete file failed when storage deleted, storage_key: %s", storage_key)

        if vector_cleanup_succeeded:
            schedule_billing_vector_space_refresh(dataset_tenant_id)
        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Cleaned dataset when dataset deleted: {dataset_id} latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception:
        logger.exception("Cleaned dataset when dataset deleted failed")
