import datetime
import logging
import time

import click
from celery import shared_task  # type: ignore

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

    Usage: retry_document_indexing_task.delay(dataset_id, document_ids)
    """
    documents: list[Document] = []
    start_at = time.perf_counter()
    try:
        dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
        if not dataset:
            logging.info(click.style(f"Dataset not found: {dataset_id}", fg="red"))
            return
        tenant_id = dataset.tenant_id
        for document_id in document_ids:
            retry_indexing_cache_key = f"document_{document_id}_is_retried"
            # check document limit
            features = FeatureService.get_features(tenant_id)
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
                    db.session.query(Document)
                    .where(Document.id == document_id, Document.dataset_id == dataset_id)
                    .first()
                )
                if document:
                    document.indexing_status = "error"
                    document.error = str(e)
                    document.stopped_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                    db.session.add(document)
                    db.session.commit()
                redis_client.delete(retry_indexing_cache_key)
                return

            logging.info(click.style(f"Start retry document: {document_id}", fg="green"))
            document = (
                db.session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
            )
            if not document:
                logging.info(click.style(f"Document not found: {document_id}", fg="yellow"))
                return
            try:
                # clean old data
                index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

                segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document_id).all()
                if segments:
                    index_node_ids = [segment.index_node_id for segment in segments]
                    # delete from vector index
                    index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                for segment in segments:
                    db.session.delete(segment)
                db.session.commit()

                document.indexing_status = "parsing"
                document.processing_started_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                db.session.add(document)
                db.session.commit()

                indexing_runner = IndexingRunner()
                indexing_runner.run([document])
                redis_client.delete(retry_indexing_cache_key)
            except Exception as ex:
                document.indexing_status = "error"
                document.error = str(ex)
                document.stopped_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                db.session.add(document)
                db.session.commit()
                logging.info(click.style(str(ex), fg="yellow"))
                redis_client.delete(retry_indexing_cache_key)
                logging.exception("retry_document_indexing_task failed, document_id: %s", document_id)
        end_at = time.perf_counter()
        logging.info(click.style(f"Retry dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
    except Exception as e:
        logging.exception(
            "retry_document_indexing_task failed, dataset_id: %s, document_ids: %s", dataset_id, document_ids
        )
        raise e
    finally:
        db.session.close()
