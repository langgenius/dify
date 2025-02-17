import datetime
import logging
import time

import click
from celery import shared_task  # type: ignore
from werkzeug.exceptions import NotFound

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from models.dataset import Dataset, Document, DocumentSegment


@shared_task(queue="dataset")
def document_indexing_update_task(dataset_id: str, org_document_id: str, new_document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_update_task.delay(dataset_id, document_id)
    """
    logging.info(
        click.style(
            "Start update orginal document {} by the duplicate {}".format(org_document_id, new_document_id), fg="green"
        )
    )

    org_document = (
        db.session.query(Document).filter(Document.id == org_document_id, Document.dataset_id == dataset_id).first()
    )
    new_document = (
        db.session.query(Document).filter(Document.id == new_document_id, Document.dataset_id == dataset_id).first()
    )
    if not org_document or not new_document:
        raise NotFound("Document not found")

    dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise NotFound("Dataset not found")

    new_document.indexing_status = "parsing"
    new_document.processing_started_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
    db.session.commit()

    try:
        start_at = time.perf_counter()
        # index new document segment
        indexing_runner = IndexingRunner()
        indexing_runner.run([new_document])
        end_at = time.perf_counter()
        logging.info(
            click.style("update document: {} latency: {}".format(new_document_id, end_at - start_at), fg="green")
        )

        # delete all stale document segment
        index_type = org_document.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()

        segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == org_document_id).all()
        if segments:
            index_node_ids = [segment.index_node_id for segment in segments]

            # delete from vector index
            index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

            for segment in segments:
                db.session.delete(segment)
            db.session.commit()

        # restore the position and delete the stale document
        org_position = org_document.position
        db.session.delete(org_document)
        db.session.commit()

        new_document.position = org_position
        db.session.add(new_document)
        db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Cleaned stale document when document update data source or process rule: {} latency: {}".format(
                    new_document_id, end_at - start_at
                ),
                fg="green",
            )
        )
    except DocumentIsPausedError as ex:
        logging.info(click.style(str(ex), fg="yellow"))
    except Exception:
        logging.exception("Cleaned document when document update data source or process rule failed")