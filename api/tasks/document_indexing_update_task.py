import logging
import time

import click
from celery import shared_task

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment


@shared_task(queue="dataset")
def document_indexing_update_task(dataset_id: str, document_id: str):
    """
    Async update document
    :param dataset_id:
    :param document_id:

    Usage: document_indexing_update_task.delay(dataset_id, document_id)
    """
    logging.info(click.style(f"Start update document: {document_id}", fg="green"))
    start_at = time.perf_counter()

    document = db.session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()

    if not document:
        logging.info(click.style(f"Document not found: {document_id}", fg="red"))
        db.session.close()
        return

    document.indexing_status = "parsing"
    document.processing_started_at = naive_utc_now()
    db.session.commit()
    dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
    if not dataset:
        raise Exception("Dataset not found")
    segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document_id).all()

    try:
        indexing_runner = IndexingRunner()
        indexing_runner.run([document])
        end_at = time.perf_counter()
        logging.info(click.style(f"update document: {document.id} latency: {end_at - start_at}", fg="green"))
        document_indexing_update_task_sync(dataset, document, segments, True)
    except DocumentIsPausedError as ex:
        logging.info(click.style(str(ex), fg="yellow"))
        document_indexing_update_task_sync(dataset, document, segments, False)
    except Exception:
        logging.exception("document_indexing_update_task failed, document_id: %s", document_id)
        document_indexing_update_task_sync(dataset, document, segments, False)
    finally:
        db.session.close()


def document_indexing_update_task_sync(
    dataset: Dataset, document: Document, old_segments: list[DocumentSegment], update_success: bool
):
    try:
        index_type = document.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()
        if update_success and document.indexing_status == "completed":
            # delete all old document segment and index
            if old_segments:
                index_node_ids = [segment.index_node_id for segment in old_segments]

                # delete from vector index
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                for segment in old_segments:
                    db.session.delete(segment)
                db.session.commit()
        else:
            # Restore the old segment status
            for segment in old_segments:
                segment.status = "completed"
            db.session.commit()
            # delete all new document segment and index
            segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
            old_segment_ids = [s.id for s in old_segments]
            new_segments = [s for s in segments if s.id not in old_segment_ids]
            if new_segments:
                index_node_ids = [segment.index_node_id for segment in new_segments]

                # delete from vector index
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                for segment in new_segments:
                    db.session.delete(segment)
                db.session.commit()
    except Exception:
        logging.exception("document_indexing_update_task_sync failed, document_id: %s", document.id)
