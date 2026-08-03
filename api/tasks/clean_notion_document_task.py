import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from models.dataset import Dataset, Document, DocumentSegment
from services.vector_service import VectorService

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
    if not document_ids:
        logger.info("No Notion documents selected for cleanup in dataset %s", dataset_id)
        return

    total_index_node_ids: list[str] = []
    total_segment_ids: list[str] = []

    with session_factory.create_session() as session, session.begin():
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))

        if not dataset:
            raise Exception("Document has no dataset")
        index_type = dataset.get_doc_form(session=session)

        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.document_id.in_(document_ids),
                DocumentSegment.dataset_id == dataset_id,
            )
        ).all()
        total_index_node_ids.extend(segment.index_node_id for segment in segments if segment.index_node_id)
        total_segment_ids.extend(segment.id for segment in segments)
        document_delete_stmt = delete(Document).where(
            Document.id.in_(document_ids),
            Document.dataset_id == dataset_id,
            Document.tenant_id == dataset.tenant_id,
        )
        session.execute(document_delete_stmt)

    # Wrap vector / keyword index cleanup in try/except so that a transient
    # failure here (e.g. billing API hiccup propagated via FeatureService when
    # ``ModelManager`` is initialized inside ``Vector(dataset)``) does not abort
    # the task and leave the already-deleted documents' segments stranded in PG.
    # The Document rows are hard-deleted in the previous session block, so any
    # exception escaping this task would produce orphans that no later request
    # can reference back. Mirrors the pattern in ``clean_dataset_task``.
    if total_index_node_ids or total_segment_ids:
        try:
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            with session_factory.create_session() as session:
                cleanup_dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
                if cleanup_dataset:
                    session.commit()
                    index_processor.clean(
                        cleanup_dataset,
                        total_index_node_ids,
                        with_keywords=True,
                        delete_child_chunks=True,
                        delete_summaries=True,
                        segment_ids=total_segment_ids,
                        session=session,
                    )
                    session.commit()
        except Exception:
            logger.exception(
                "Failed to clean vector / keyword index in clean_notion_document_task, "
                "dataset_id=%s, document_ids=%s, index_node_ids_count=%d. "
                "Continuing with segment deletion; stale external index objects may remain.",
                dataset_id,
                document_ids,
                len(total_index_node_ids),
            )

    with session_factory.create_session() as session, session.begin():
        VectorService.delete_segment_index_artifacts(
            session=session,
            dataset_id=dataset_id,
            segment_ids=total_segment_ids,
        )
        session.execute(
            delete(DocumentSegment).where(
                DocumentSegment.document_id.in_(document_ids),
                DocumentSegment.dataset_id == dataset_id,
            )
        )

    end_at = time.perf_counter()
    logger.info(
        click.style(
            "Clean document when import form notion document deleted end :: {} latency: {}".format(
                dataset_id, end_at - start_at
            ),
            fg="green",
        )
    )
