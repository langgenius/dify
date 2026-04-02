import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_storage import storage
from models.dataset import Dataset, DatasetMetadataBinding, DocumentSegment
from models.model import UploadFile

logger = logging.getLogger(__name__)

# Batch size for database operations to keep transactions short
BATCH_SIZE = 1000


@shared_task(queue="dataset")
def batch_clean_document_task(document_ids: list[str], dataset_id: str, doc_form: str | None, file_ids: list[str]):
    """
    Clean document when document deleted.
    :param document_ids: document ids
    :param dataset_id: dataset id
    :param doc_form: doc_form
    :param file_ids: file ids

    Usage: batch_clean_document_task.delay(document_ids, dataset_id)
    """
    logger.info(click.style("Start batch clean documents when documents deleted", fg="green"))
    start_at = time.perf_counter()
    if not doc_form:
        raise ValueError("doc_form is required")

    storage_keys_to_delete: list[str] = []
    index_node_ids: list[str] = []
    segment_ids: list[str] = []
    total_image_upload_file_ids: list[str] = []

    try:
        # ============ Step 1: Query segment and file data (short read-only transaction) ============
        with session_factory.create_session() as session:
            # Get segments info
            segments = session.scalars(
                select(DocumentSegment).where(DocumentSegment.document_id.in_(document_ids))
            ).all()

            if segments:
                index_node_ids = [segment.index_node_id for segment in segments]
                segment_ids = [segment.id for segment in segments]

                # Collect image file IDs from segment content
                for segment in segments:
                    image_upload_file_ids = get_image_upload_file_ids(segment.content)
                    total_image_upload_file_ids.extend(image_upload_file_ids)

            # Query storage keys for image files
            if total_image_upload_file_ids:
                image_files = session.scalars(
                    select(UploadFile).where(UploadFile.id.in_(total_image_upload_file_ids))
                ).all()
                storage_keys_to_delete.extend([f.key for f in image_files if f and f.key])

            # Query storage keys for document files
            if file_ids:
                files = session.scalars(select(UploadFile).where(UploadFile.id.in_(file_ids))).all()
                storage_keys_to_delete.extend([f.key for f in files if f and f.key])

        # ============ Step 2: Clean vector index (external service, fresh session for dataset) ============
        if index_node_ids:
            try:
                # Fetch dataset in a fresh session to avoid DetachedInstanceError
                with session_factory.create_session() as session:
                    dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
                    if not dataset:
                        logger.warning("Dataset not found for vector index cleanup, dataset_id: %s", dataset_id)
                    else:
                        index_processor = IndexProcessorFactory(doc_form).init_index_processor()
                        index_processor.clean(
                            dataset, index_node_ids, with_keywords=True, delete_child_chunks=True, delete_summaries=True
                        )
            except Exception:
                logger.exception(
                    "Failed to clean vector index for dataset_id: %s, document_ids: %s, index_node_ids count: %d",
                    dataset_id,
                    document_ids,
                    len(index_node_ids),
                )

        # ============ Step 3: Delete metadata binding (separate short transaction) ============
        try:
            with session_factory.create_session() as session:
                deleted_count = (
                    session.query(DatasetMetadataBinding)
                    .where(
                        DatasetMetadataBinding.dataset_id == dataset_id,
                        DatasetMetadataBinding.document_id.in_(document_ids),
                    )
                    .delete(synchronize_session=False)
                )
                session.commit()
                logger.debug("Deleted %d metadata bindings for dataset_id: %s", deleted_count, dataset_id)
        except Exception:
            logger.exception(
                "Failed to delete metadata bindings for dataset_id: %s, document_ids: %s",
                dataset_id,
                document_ids,
            )

        # ============ Step 4: Batch delete UploadFile records (multiple short transactions) ============
        if total_image_upload_file_ids:
            failed_batches = 0
            total_batches = (len(total_image_upload_file_ids) + BATCH_SIZE - 1) // BATCH_SIZE
            for i in range(0, len(total_image_upload_file_ids), BATCH_SIZE):
                batch = total_image_upload_file_ids[i : i + BATCH_SIZE]
                try:
                    with session_factory.create_session() as session:
                        stmt = delete(UploadFile).where(UploadFile.id.in_(batch))
                        session.execute(stmt)
                        session.commit()
                except Exception:
                    failed_batches += 1
                    logger.exception(
                        "Failed to delete image UploadFile batch %d-%d for dataset_id: %s",
                        i,
                        i + len(batch),
                        dataset_id,
                    )
            if failed_batches > 0:
                logger.warning(
                    "Image UploadFile deletion: %d/%d batches failed for dataset_id: %s",
                    failed_batches,
                    total_batches,
                    dataset_id,
                )

        # ============ Step 5: Batch delete DocumentSegment records (multiple short transactions) ============
        if segment_ids:
            failed_batches = 0
            total_batches = (len(segment_ids) + BATCH_SIZE - 1) // BATCH_SIZE
            for i in range(0, len(segment_ids), BATCH_SIZE):
                batch = segment_ids[i : i + BATCH_SIZE]
                try:
                    with session_factory.create_session() as session:
                        segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.id.in_(batch))
                        session.execute(segment_delete_stmt)
                        session.commit()
                except Exception:
                    failed_batches += 1
                    logger.exception(
                        "Failed to delete DocumentSegment batch %d-%d for dataset_id: %s, document_ids: %s",
                        i,
                        i + len(batch),
                        dataset_id,
                        document_ids,
                    )
            if failed_batches > 0:
                logger.warning(
                    "DocumentSegment deletion: %d/%d batches failed, document_ids: %s",
                    failed_batches,
                    total_batches,
                    document_ids,
                )

        # ============ Step 6: Delete document-associated files (separate short transaction) ============
        if file_ids:
            try:
                with session_factory.create_session() as session:
                    stmt = delete(UploadFile).where(UploadFile.id.in_(file_ids))
                    session.execute(stmt)
                    session.commit()
            except Exception:
                logger.exception(
                    "Failed to delete document UploadFile records for dataset_id: %s, file_ids: %s",
                    dataset_id,
                    file_ids,
                )

        # ============ Step 7: Delete storage files (I/O operations, no DB transaction) ============
        storage_delete_failures = 0
        for storage_key in storage_keys_to_delete:
            try:
                storage.delete(storage_key)
            except Exception:
                storage_delete_failures += 1
                logger.exception("Failed to delete file from storage, key: %s", storage_key)
        if storage_delete_failures > 0:
            logger.warning(
                "Storage file deletion completed with %d failures out of %d total files for dataset_id: %s",
                storage_delete_failures,
                len(storage_keys_to_delete),
                dataset_id,
            )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Cleaned documents when documents deleted latency: {end_at - start_at:.2f}s, "
                f"dataset_id: {dataset_id}, document_ids: {document_ids}, "
                f"segments: {len(segment_ids)}, image_files: {len(total_image_upload_file_ids)}, "
                f"storage_files: {len(storage_keys_to_delete)}",
                fg="green",
            )
        )
    except Exception:
        logger.exception(
            "Batch clean documents failed for dataset_id: %s, document_ids: %s",
            dataset_id,
            document_ids,
        )
