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

    with session_factory.create_session() as session:
        try:
            dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()

            if not dataset:
                raise Exception("Document has no dataset")

            session.query(DatasetMetadataBinding).where(
                DatasetMetadataBinding.dataset_id == dataset_id,
                DatasetMetadataBinding.document_id.in_(document_ids),
            ).delete(synchronize_session=False)
            session.commit()

            segments = session.scalars(
                select(DocumentSegment).where(DocumentSegment.document_id.in_(document_ids))
            ).all()
            # check segment is exist
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments]
                index_processor = IndexProcessorFactory(doc_form).init_index_processor()
                index_processor.clean(
                    dataset, index_node_ids, with_keywords=True, delete_child_chunks=True, delete_summaries=True
                )

                segment_ids = [segment.id for segment in segments]
                total_image_upload_file_ids = []
                for segment in segments:
                    image_upload_file_ids = get_image_upload_file_ids(segment.content)
                    total_image_upload_file_ids.extend(image_upload_file_ids)
                    image_files = session.query(UploadFile).where(UploadFile.id.in_(image_upload_file_ids)).all()
                    for image_file in image_files:
                        try:
                            if image_file and image_file.key:
                                storage.delete(image_file.key)
                        except Exception:
                            logger.exception(
                                "Delete image_files failed when storage deleted, \
                                              image_upload_file_is: %s",
                                image_file.id,
                            )

                for i in range(0, len(total_image_upload_file_ids), 1000):
                    stmt = delete(UploadFile).where(UploadFile.id.in_(total_image_upload_file_ids[i : i + 1000]))
                    session.execute(stmt)
                session.commit()

                for i in range(0, len(segment_ids), 1000):
                    segment_delete_stmt = delete(DocumentSegment).where(
                        DocumentSegment.id.in_(segment_ids[i : i + 1000])
                    )
                    session.execute(segment_delete_stmt)
                session.commit()
            if file_ids:
                files = session.scalars(select(UploadFile).where(UploadFile.id.in_(file_ids))).all()
                for file in files:
                    try:
                        storage.delete(file.key)
                    except Exception:
                        logger.exception("Delete file failed when document deleted, file_id: %s", file.id)
                stmt = delete(UploadFile).where(UploadFile.id.in_(file_ids))
                session.execute(stmt)
                session.commit()

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Cleaned documents when documents deleted latency: {end_at - start_at}",
                    fg="green",
                )
            )
        except Exception:
            logger.exception("Cleaned documents when documents deleted failed")
