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
from models.dataset import Dataset, DocumentSegment
from models.enums import IndexingStatus
from services.dataset_ref_service import DatasetRefService
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
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if dataset is None:
            raise ValueError("Dataset not found")
        tenant_id = dataset.tenant_id
        dataset_ref = DatasetRefService.create_dataset_ref(dataset)
        document_ref = DatasetRefService.create_document_ref_from_id(dataset_ref, document_id)
        document = DatasetRefService.get_document_by_ref(document_ref, session=session)
        if document is None:
            logger.info(click.style(f"Document not found: {document_id}", fg="yellow"))
            return
        if document.data_source_type != "website_crawl":
            raise ValueError("Document is not a website document")

        sync_indexing_cache_key = f"document_{document_id}_is_sync"
        # check document limit
        features = FeatureService.get_features(dataset.tenant_id)
        try:
            if features.billing.enabled:
                vector_space = features.vector_space
                assert vector_space is not None
                if 0 < vector_space.limit <= vector_space.size:
                    raise ValueError(
                        "Your total number of documents plus the number of uploads have over the limit of "
                        "your subscription."
                    )
        except Exception as e:
            document.indexing_status = IndexingStatus.ERROR
            document.error = str(e)
            document.stopped_at = naive_utc_now()
            session.add(document)
            session.commit()
            redis_client.delete(sync_indexing_cache_key)
            return

        logger.info(click.style(f"Start sync website document: {document_id}", fg="green"))
        try:
            # clean old data
            index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

            segments = session.scalars(
                select(DocumentSegment).where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == document_id,
                )
            ).all()
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
                # delete from vector index
                if index_node_ids:
                    index_processor.clean(
                        dataset, index_node_ids, with_keywords=True, delete_child_chunks=True, session=session
                    )

            segment_ids = [segment.id for segment in segments]
            if segment_ids:
                segment_delete_stmt = delete(DocumentSegment).where(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == document_id,
                )
                session.execute(segment_delete_stmt)
            session.commit()

            document.indexing_status = IndexingStatus.PARSING
            document.processing_started_at = naive_utc_now()
            session.add(document)
            # Release document/segment locks before extraction starts.
            session.commit()

            indexing_runner = IndexingRunner()
            indexing_runner.run([document], session)
            session.commit()
            redis_client.delete(sync_indexing_cache_key)
        except Exception as ex:
            session.rollback()
            document = DatasetRefService.get_document_by_ref(document_ref, session=session)
            if document:
                document.indexing_status = IndexingStatus.ERROR
                document.error = str(ex)
                document.stopped_at = naive_utc_now()
                session.add(document)
                session.commit()
            logger.info(click.style(str(ex), fg="yellow"))
            redis_client.delete(sync_indexing_cache_key)
            logger.exception("sync_website_document_indexing_task failed, document_id: %s", document_id)
        end_at = time.perf_counter()
        logger.info(click.style(f"Sync document: {document_id} latency: {end_at - start_at}", fg="green"))
