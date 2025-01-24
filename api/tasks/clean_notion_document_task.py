import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment


@shared_task(queue="dataset")
def clean_notion_document_task(document_ids: list[str], dataset_id: str):
    """
    Clean document when document deleted.
    :param document_ids: document ids
    :param dataset_id: dataset id

    Usage: clean_notion_document_task.delay(document_ids, dataset_id)
    """
    logging.info(
        click.style("Start clean document when import form notion document deleted: {}".format(dataset_id), fg="green")
    )
    start_at = time.perf_counter()

    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()

        if not dataset:
            raise Exception("Document has no dataset")
        index_type = dataset.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        for document_id in document_ids:
            document = db.session.query(Document).filter(Document.id == document_id).first()
            db.session.delete(document)

            segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document_id).all()
            index_node_ids = [segment.index_node_id for segment in segments]

            index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

            for segment in segments:
                db.session.delete(segment)
        db.session.commit()
        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Clean document when import form notion document deleted end :: {} latency: {}".format(
                    dataset_id, end_at - start_at
                ),
                fg="green",
            )
        )
    except Exception:
        logging.exception("Cleaned document when import form notion document deleted  failed")
