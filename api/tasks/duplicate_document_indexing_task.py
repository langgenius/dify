import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from configs import dify_config
from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def duplicate_document_indexing_task(dataset_id: str, document_ids: list):
    """
    Async process document
    :param dataset_id:
    :param document_ids:

    Usage: duplicate_document_indexing_task.delay(dataset_id, document_ids)
    """
    documents = []
    start_at = time.perf_counter()

    try:
        dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
        if dataset is None:
            logger.info(click.style(f"Dataset not found: {dataset_id}", fg="red"))
            db.session.close()
            return

        # check document limit
        features = FeatureService.get_features(dataset.tenant_id)
        try:
            if features.billing.enabled:
                vector_space = features.vector_space
                count = len(document_ids)
                if features.billing.subscription.plan == "sandbox" and count > 1:
                    raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
                batch_upload_limit = int(dify_config.BATCH_UPLOAD_LIMIT)
                if count > batch_upload_limit:
                    raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")
                current = int(getattr(vector_space, "size", 0) or 0)
                limit = int(getattr(vector_space, "limit", 0) or 0)
                if limit > 0 and (current + count) > limit:
                    raise ValueError(
                        "Your total number of documents plus the number of uploads have exceeded the limit of "
                        "your subscription."
                    )
        except Exception as e:
            for document_id in document_ids:
                document = (
                    db.session.query(Document)
                    .where(Document.id == document_id, Document.dataset_id == dataset_id)
                    .first()
                )
                if document:
                    document.indexing_status = "error"
                    document.error = str(e)
                    document.stopped_at = naive_utc_now()
                    db.session.add(document)
            db.session.commit()
            return

        for document_id in document_ids:
            logger.info(click.style(f"Start process document: {document_id}", fg="green"))

            document = (
                db.session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
            )

            if document:
                # clean old data
                index_type = document.doc_form
                index_processor = IndexProcessorFactory(index_type).init_index_processor()

                segments = db.session.scalars(
                    select(DocumentSegment).where(DocumentSegment.document_id == document_id)
                ).all()
                if segments:
                    index_node_ids = [segment.index_node_id for segment in segments]

                    # delete from vector index
                    index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                    for segment in segments:
                        db.session.delete(segment)
                    db.session.commit()

                document.indexing_status = "parsing"
                document.processing_started_at = naive_utc_now()
                documents.append(document)
                db.session.add(document)
        db.session.commit()

        indexing_runner = IndexingRunner()
        indexing_runner.run(documents)
        end_at = time.perf_counter()
        logger.info(click.style(f"Processed dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except Exception:
        logger.exception("duplicate_document_indexing_task failed, dataset_id: %s", dataset_id)
    finally:
        db.session.close()
