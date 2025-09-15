import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.dataset import Dataset, DatasetMetadataBinding, DocumentSegment
from models.model import UploadFile

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def clean_document_task(document_id: str, dataset_id: str, doc_form: str, file_id: str | None):
    """
    Clean document when document deleted.
    :param document_id: document id
    :param dataset_id: dataset id
    :param doc_form: doc_form
    :param file_id: file id

    Usage: clean_document_task.delay(document_id, dataset_id)
    """
    logger.info(click.style(f"Start clean document when document deleted: {document_id}", fg="green"))
    start_at = time.perf_counter()

    try:
        dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()

        if not dataset:
            raise Exception("Document has no dataset")

        segments = db.session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
        # check segment is exist
        if segments:
            index_node_ids = [segment.index_node_id for segment in segments]
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

            for segment in segments:
                image_upload_file_ids = get_image_upload_file_ids(segment.content)
                for upload_file_id in image_upload_file_ids:
                    image_file = db.session.query(UploadFile).where(UploadFile.id == upload_file_id).first()
                    if image_file is None:
                        continue
                    try:
                        storage.delete(image_file.key)
                    except Exception:
                        logger.exception(
                            "Delete image_files failed when storage deleted, \
                                          image_upload_file_is: %s",
                            upload_file_id,
                        )
                    db.session.delete(image_file)
                db.session.delete(segment)

            db.session.commit()
        if file_id:
            file = db.session.query(UploadFile).where(UploadFile.id == file_id).first()
            if file:
                try:
                    storage.delete(file.key)
                except Exception:
                    logger.exception("Delete file failed when document deleted, file_id: %s", file_id)
                db.session.delete(file)
                db.session.commit()

        # delete dataset metadata binding
        db.session.query(DatasetMetadataBinding).where(
            DatasetMetadataBinding.dataset_id == dataset_id,
            DatasetMetadataBinding.document_id == document_id,
        ).delete()
        db.session.commit()

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Cleaned document when document deleted: {document_id} latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception:
        logger.exception("Cleaned document when document deleted failed")
    finally:
        db.session.close()
