import logging
import time
from typing import Optional

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.dataset import Dataset, DocumentSegment
from models.model import UploadFile


@shared_task(queue="dataset")
def clean_document_task(document_id: str, dataset_id: str, doc_form: str, file_id: Optional[str]):
    """
    Clean document when document deleted.
    :param document_id: document id
    :param dataset_id: dataset id
    :param doc_form: doc_form
    :param file_id: file id

    Usage: clean_document_task.delay(document_id, dataset_id)
    """
    logging.info(click.style("Start clean document when document deleted: {}".format(document_id), fg="green"))
    start_at = time.perf_counter()

    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

        if not dataset:
            raise Exception("Document has no dataset")

        segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document_id).all()
        # check segment is exist
        if segments:
            index_node_ids = [segment.index_node_id for segment in segments]
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

            for segment in segments:
                image_upload_file_ids = get_image_upload_file_ids(segment.content)
                for upload_file_id in image_upload_file_ids:
                    image_file = db.session.query(UploadFile).filter(UploadFile.id == upload_file_id).first()
                    if image_file is None:
                        continue
                    try:
                        storage.delete(image_file.key)
                    except Exception:
                        logging.exception(
                            "Delete image_files failed when storage deleted, \
                                          image_upload_file_is: {}".format(upload_file_id)
                        )
                    db.session.delete(image_file)
                db.session.delete(segment)

            db.session.commit()
        if file_id:
            file = db.session.query(UploadFile).filter(UploadFile.id == file_id).first()
            if file:
                try:
                    storage.delete(file.key)
                except Exception:
                    logging.exception("Delete file failed when document deleted, file_id: {}".format(file_id))
                db.session.delete(file)
                db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Cleaned document when document deleted: {} latency: {}".format(document_id, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("Cleaned document when document deleted failed")
