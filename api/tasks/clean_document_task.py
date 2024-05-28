import logging
import time

import click
from celery import shared_task

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from models.dataset import Dataset, DocumentSegment


@shared_task(queue='dataset')
def clean_document_task(document_id: str, dataset_id: str, doc_form: str):
    """
    Clean document when document deleted.
    :param document_id: document id
    :param dataset_id: dataset id
    :param doc_form: doc_form

    Usage: clean_document_task.delay(document_id, dataset_id)
    """
    logging.info(click.style('Start clean document when document deleted: {}'.format(document_id), fg='green'))
    start_at = time.perf_counter()

    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

        if not dataset:
            raise Exception('Document has no dataset')

        segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document_id).all()
        # check segment is exist
        if segments:
            index_node_ids = [segment.index_node_id for segment in segments]
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.clean(dataset, index_node_ids)

            for segment in segments:
                db.session.delete(segment)

            db.session.commit()
            end_at = time.perf_counter()
            logging.info(
                click.style('Cleaned document when document deleted: {} latency: {}'.format(document_id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("Cleaned document when document deleted failed")
