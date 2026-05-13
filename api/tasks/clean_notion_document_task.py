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
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))

        if not dataset:
            raise Exception("Document has no dataset")
        index_type = dataset.doc_form
        index_processor = IndexProcessorFactory(index_type).init_index_processor()

        document_delete_stmt = delete(Document).where(Document.id.in_(document_ids))
        session.execute(document_delete_stmt)

        for document_id in document_ids:
            segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
            total_index_node_ids.extend([segment.index_node_id for segment in segments if segment.index_node_id])

    # Wrap vector / keyword index cleanup in try/except so that a transient
    # failure here (e.g. billing API hiccup propagated via FeatureService when
    # ``ModelManager`` is initialized inside ``Vector(dataset)``) does not abort
    # the task and leave the already-deleted documents' segments stranded in PG.
    # The Document rows are hard-deleted in the previous session block, so any
    # exception escaping this task would produce orphans that no later request
    # can reference back. Mirrors the pattern in ``clean_dataset_task``.
    try:
        with session_factory.create_session() as session:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            if dataset:
                index_processor.clean(
                    dataset, total_index_node_ids, with_keywords=True, delete_child_chunks=True, delete_summaries=True
                )
    except Exception:
        logger.exception(
            "Failed to clean vector / keyword index in clean_notion_document_task, "
            "dataset_id=%s, document_ids=%s, index_node_ids_count=%d. "
            "Continuing with segment deletion; vector orphans can be reaped later.",
            dataset_id,
            document_ids,
            len(total_index_node_ids),
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
