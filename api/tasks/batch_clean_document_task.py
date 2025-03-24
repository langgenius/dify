import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.dataset import Dataset, DocumentSegment
from models.model import UploadFile


@shared_task(queue="dataset")
def batch_clean_document_task(document_ids: list[str], dataset_id: str, doc_form: str, file_ids: list[str]):
    """
    Clean document when document deleted.
    :param document_ids: document ids
    :param dataset_id: dataset id
    :param doc_form: doc_form
    :param file_ids: file ids

    Usage: batch_clean_document_task.delay(document_ids, dataset_id)
    """
    logging.info(click.style("Start batch clean documents when documents deleted", fg="green"))
    start_at = time.perf_counter()

    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

        if not dataset:
            raise Exception("Document has no dataset")

        segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id.in_(document_ids)).all()
        # check segment is exist
        if segments:
            index_node_ids = [segment.index_node_id for segment in segments]
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

            for segment in segments:
                image_upload_file_ids = get_image_upload_file_ids(segment.content)
                for upload_file_id in image_upload_file_ids:
                    image_file = db.session.query(UploadFile).filter(UploadFile.id == upload_file_id).first()
                    try:
                        if image_file and image_file.key:
                            storage.delete(image_file.key)
                    except Exception:
                        logging.exception(
                            "Delete image_files failed when storage deleted, \
                                          image_upload_file_is: {}".format(upload_file_id)
                        )
                    db.session.delete(image_file)
                db.session.delete(segment)

            db.session.commit()
        if file_ids:
            files = db.session.query(UploadFile).filter(UploadFile.id.in_(file_ids)).all()
            for file in files:
                try:
                    storage.delete(file.key)
                except Exception:
                    logging.exception("Delete file failed when document deleted, file_id: {}".format(file.id))
                db.session.delete(file)
            db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Cleaned documents when documents deleted latency: {}".format(end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("Cleaned documents when documents deleted failed")
