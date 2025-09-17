import logging
import time

import click
from celery import shared_task  # type: ignore

from extensions.ext_database import db
from models import DocumentSegment

logger = logging.getLogger(__name__)


@shared_task(queue="dataset_segment")
def segment_keyword_create_task(dataset_id: str, document_id: str, index_node_ids: list):
    """
    Async process segment
    :param dataset_id:
    :param document_id:
    :param index_node_ids:

    Usage: segment_keyword_create_task.delay(dataset_id, document_id, index_node_ids)
    """
    start_at = time.perf_counter()

    segments = (
        db.session.query(DocumentSegment)
        .filter(
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
            DocumentSegment.index_node_id.in_(index_node_ids),
        )
        .all()
    )
    if not segments:
        logger.info(click.style("Segment is not found: {} {}".format(dataset_id, index_node_ids), fg="yellow"))
        return

    from core.indexing_runner import DocumentIsPausedError, IndexingRunner

    try:
        logger.info(
            click.style(
                "Start Index Segment {} {} {}".format(dataset_id, document_id, time.perf_counter() - start_at),
                fg="green",
            )
        )
        indexing_runner = IndexingRunner()
        indexing_runner.run_segment_keyword(dataset_id, document_id, segments)
        end_at = time.perf_counter()
        logger.info(
            click.style(
                "Processed Segment: {} {} latency: {}".format(dataset_id, document_id, end_at - start_at), fg="green"
            )
        )
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except Exception:
        pass
