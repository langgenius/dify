import datetime
import logging
import time

import click
from celery import shared_task

from core.indexing_runner import IndexingRunner
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document, DocumentSegment
from services.feature_service import FeatureService


@shared_task(queue="dataset")
def retry_document_indexing_task(dataset_id: str, document_ids: list[str]):
    """
    Async process document
    :param dataset_id:
    :param document_ids:

    Usage: retry_document_indexing_task.delay(dataset_id, document_id)
    """
    documents = []
    start_at = time.perf_counter()

    dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
    for document_id in document_ids:
        retry_indexing_cache_key = "document_{}_is_retried".format(document_id)
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
                db.session.query(Document).filter(Document.id == document_id, Document.dataset_id == dataset_id).first()
            )
            if document:
                document.indexing_status = "error"
                document.error = str(e)
                document.stopped_at = datetime.datetime.utcnow()
                db.session.add(document)
                db.session.commit()
            redis_client.delete(retry_indexing_cache_key)
            return

        logging.info(click.style("Start retry document: {}".format(document_id), fg="green"))
        document = (
            db.session.query(Document).filter(Document.id == document_id, Document.dataset_id == dataset_id).first()
        )
        try:
            if document:
                # clean old data
                index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

                segments = db.session.query(DocumentSegment).filter(DocumentSegment.document_id == document_id).all()
                if segments:
                    index_node_ids = [segment.index_node_id for segment in segments]
                    # delete from vector index
                    index_processor.clean(dataset, index_node_ids)

                    for segment in segments:
                        db.session.delete(segment)
                    db.session.commit()

                document.indexing_status = "parsing"
                document.processing_started_at = datetime.datetime.utcnow()
                db.session.add(document)
                db.session.commit()

                indexing_runner = IndexingRunner()
                indexing_runner.run([document])
                redis_client.delete(retry_indexing_cache_key)
        except Exception as ex:
            document.indexing_status = "error"
            document.error = str(ex)
            document.stopped_at = datetime.datetime.utcnow()
            db.session.add(document)
            db.session.commit()
            logging.info(click.style(str(ex), fg="yellow"))
            redis_client.delete(retry_indexing_cache_key)
            pass
    end_at = time.perf_counter()
    logging.info(click.style("Retry dataset: {} latency: {}".format(dataset_id, end_at - start_at), fg="green"))
