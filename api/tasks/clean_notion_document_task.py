import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from models.dataset import Dataset, Document, DocumentSegment

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def clean_notion_document_task(document_ids: list[str], dataset_id: str):
    """
    Clean document when document deleted.
    :param document_ids: document ids
    :param dataset_id: dataset id

    Usage: clean_notion_document_task.delay(document_ids, dataset_id)
    """
    logger.info(click.style(f"Start clean document when import form notion document deleted: {dataset_id}", fg="green"))
    start_at = time.perf_counter()
    total_index_node_ids = []

    with session_factory.create_session() as session:
        dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()

        if not dataset:
            raise Exception("Document has no dataset")
        index_type = dataset.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()

        document_delete_stmt = delete(Document).where(Document.id.in_(document_ids))
        session.execute(document_delete_stmt)

        for document_id in document_ids:
            segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
            total_index_node_ids.extend([segment.index_node_id for segment in segments])

    with session_factory.create_session() as session:
        dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
        if dataset:
            index_processor.clean(
                dataset, total_index_node_ids, with_keywords=True, delete_child_chunks=True, delete_summaries=True
            )

    with session_factory.create_session() as session, session.begin():
        segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.document_id.in_(document_ids))
        session.execute(segment_delete_stmt)

    end_at = time.perf_counter()
    logger.info(
        click.style(
            "Clean document when import form notion document deleted end :: {} latency: {}".format(
                dataset_id, end_at - start_at
            ),
            fg="green",
        )
    )
