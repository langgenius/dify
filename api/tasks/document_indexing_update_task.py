import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def document_indexing_update_task(dataset_id: str, document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_update_task.delay(dataset_id, document_id)
    """
    logger.info(click.style(f"Start update document: {document_id}", fg="green"))
    start_at = time.perf_counter()

    document = db.session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()

    if not document:
        logger.info(click.style(f"Document not found: {document_id}", fg="red"))
        db.session.close()
        return

    document.indexing_status = "parsing"
    document.processing_started_at = naive_utc_now()
    db.session.commit()

    # delete all document segment and index
    try:
        dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            raise Exception("Dataset not found")

        index_type = document.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()

        segments = db.session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
        if segments:
            index_node_ids = [segment.index_node_id for segment in segments]

            # delete from vector index
            index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

            for segment in segments:
                db.session.delete(segment)
            db.session.commit()
        end_at = time.perf_counter()
        logger.info(
            click.style(
                "Cleaned document when document update data source or process rule: {} latency: {}".format(
                    document_id, end_at - start_at
                ),
                fg="green",
            )
        )
    except Exception:
        logger.exception("Cleaned document when document update data source or process rule failed")

    try:
        indexing_runner = IndexingRunner()
        indexing_runner.run([document])
        end_at = time.perf_counter()
        logger.info(click.style(f"update document: {document.id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except Exception:
        logger.exception("document_indexing_update_task failed, document_id: %s", document_id)
    finally:
        db.session.close()
