import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.indexing_runner import IndexingRunner
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def sync_website_document_indexing_task(dataset_id: str, document_id: str):
    """
    Async process document
    :param dataset_id:
    :param document_id:

    Usage: sync_website_document_indexing_task.delay(dataset_id, document_id)
    """
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()
        if dataset is None:
            raise ValueError("Dataset not found")

        sync_indexing_cache_key = f"document_{document_id}_is_sync"
        # check document limit
        features = FeatureService.get_features(dataset.tenant_id)
        try:
            if features.billing.enabled:
                vector_space = features.vector_space
                if 0 < vector_space.limit <= vector_space.size:
                    raise ValueError(
                        "Your total number of documents plus the number of uploads have over the limit of "
                        "your subscription."
                    )
        except Exception as e:
            document = (
                session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
            )
            if document:
                document.indexing_status = "error"
                document.error = str(e)
                document.stopped_at = naive_utc_now()
                session.add(document)
                session.commit()
            redis_client.delete(sync_indexing_cache_key)
            return

        logger.info(click.style(f"Start sync website document: {document_id}", fg="green"))
        document = session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
        if not document:
            logger.info(click.style(f"Document not found: {document_id}", fg="yellow"))
            return
        try:
            # clean old data
            index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

            segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments]
                # delete from vector index
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

            segment_ids = [segment.id for segment in segments]
            segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.id.in_(segment_ids))
            session.execute(segment_delete_stmt)
            session.commit()

            document.indexing_status = "parsing"
            document.processing_started_at = naive_utc_now()
            session.add(document)
            session.commit()

            indexing_runner = IndexingRunner()
            indexing_runner.run([document])
            redis_client.delete(sync_indexing_cache_key)
        except Exception as ex:
            document.indexing_status = "error"
            document.error = str(ex)
            document.stopped_at = naive_utc_now()
            session.add(document)
            session.commit()
            logger.info(click.style(str(ex), fg="yellow"))
            redis_client.delete(sync_indexing_cache_key)
            logger.exception("sync_website_document_indexing_task failed, document_id: %s", document_id)
        end_at = time.perf_counter()
        logger.info(click.style(f"Sync document: {document_id} latency: {end_at - start_at}", fg="green"))
