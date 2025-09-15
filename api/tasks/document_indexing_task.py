import logging
import time

import click
from celery import shared_task

from configs import dify_config
from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def document_indexing_task(dataset_id: str, document_ids: list):
    """
    Async process document
    :param dataset_id:
    :param document_ids:

    Usage: document_indexing_task.delay(dataset_id, document_ids)
    """
    documents = []
    start_at = time.perf_counter()

    dataset = db.session.query(Dataset).where(Dataset.id == dataset_id).first()
    if not dataset:
        logger.info(click.style(f"Dataset is not found: {dataset_id}", fg="yellow"))
        db.session.close()
        return
    # check document limit
    features = FeatureService.get_features(dataset.tenant_id)
    try:
        if features.billing.enabled:
            vector_space = features.vector_space
            count = len(document_ids)
            batch_upload_limit = int(dify_config.BATCH_UPLOAD_LIMIT)
            if features.billing.subscription.plan == "sandbox" and count > 1:
                raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
            if count > batch_upload_limit:
                raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")
            if 0 < vector_space.limit <= vector_space.size:
                raise ValueError(
                    "Your total number of documents plus the number of uploads have over the limit of "
                    "your subscription."
                )
    except Exception as e:
        for document_id in document_ids:
            document = (
                db.session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
            )
            if document:
                document.indexing_status = "error"
                document.error = str(e)
                document.stopped_at = naive_utc_now()
                db.session.add(document)
        db.session.commit()
        db.session.close()
        return

    for document_id in document_ids:
        logger.info(click.style(f"Start process document: {document_id}", fg="green"))

        document = (
            db.session.query(Document).where(Document.id == document_id, Document.dataset_id == dataset_id).first()
        )

        if document:
            document.indexing_status = "parsing"
            document.processing_started_at = naive_utc_now()
            documents.append(document)
            db.session.add(document)
    db.session.commit()

    try:
        indexing_runner = IndexingRunner()
        indexing_runner.run(documents)
        end_at = time.perf_counter()
        logger.info(click.style(f"Processed dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
    except DocumentIsPausedError as ex:
        logger.info(click.style(str(ex), fg="yellow"))
    except Exception:
        logger.exception("Document indexing task failed, dataset_id: %s", dataset_id)
    finally:
        db.session.close()
