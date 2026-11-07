import logging
import tempfile
import time
from pathlib import Path

import click
import pandas as pd
from celery import shared_task
from sqlalchemy import select

from core.credit_usage import CreditUsageCreatedBy
from core.db.session_factory import session_factory
from core.model_context import with_credit_usage_created_by
from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models.dataset import Dataset, Document
from models.model import UploadFile
from services.knowledge.entities.resource_scope import DatasetRef

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
@with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
def batch_create_segment_to_index_task(
    job_id: str,
    upload_file_id: str,
    dataset_id: str,
    document_id: str,
    tenant_id: str,
    user_id: str,
):
    """
    Async batch create segment to index
    :param job_id:
    :param upload_file_id:
    :param dataset_id:
    :param document_id:
    :param tenant_id:
    :param user_id:

    Usage: batch_create_segment_to_index_task.delay(job_id, upload_file_id, dataset_id, document_id, tenant_id, user_id)
    """
    logger.info(click.style(f"Start batch create segment jobId: {job_id}", fg="green"))
    start_at = time.perf_counter()

    indexing_cache_key = f"segment_batch_import_{job_id}"

    # Initialize variables with default values
    upload_file_key: str | None = None
    document_doc_form: str | None = None

    with session_factory.create_session() as session:
        try:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id))
            if not dataset:
                raise ValueError("Dataset not exist.")

            dataset_document = session.scalar(
                select(Document).where(
                    Document.id == document_id, Document.dataset_id == dataset_id, Document.tenant_id == tenant_id
                )
            )
            if not dataset_document:
                raise ValueError("Document not exist.")

            if (
                not dataset_document.enabled
                or dataset_document.archived
                or dataset_document.indexing_status != "completed"
            ):
                raise ValueError("Document is not available.")

            upload_file = session.scalar(
                select(UploadFile).where(UploadFile.id == upload_file_id, UploadFile.tenant_id == tenant_id)
            )
            if not upload_file:
                raise ValueError("UploadFile not found.")

            document_doc_form = dataset_document.doc_form

            upload_file_key = upload_file.key

        except Exception:
            logger.exception("Segments batch created index failed")
            redis_client.setex(indexing_cache_key, 600, "error")
            return

    # Ensure required variables are set before proceeding
    if upload_file_key is None or document_doc_form is None:
        logger.error("Required configuration not set due to session error")
        redis_client.setex(indexing_cache_key, 600, "error")
        return

    try:
        with tempfile.TemporaryDirectory() as temp_dir:
            suffix = Path(upload_file_key).suffix
            file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"  # type: ignore
            storage.download(upload_file_key, file_path)

            df = pd.read_csv(file_path, dtype=str, keep_default_na=False)
            content = []
            for _, row in df.iterrows():
                if document_doc_form == IndexStructureType.QA_INDEX:
                    data = {"content": row.iloc[0], "answer": row.iloc[1]}
                else:
                    data = {"content": row.iloc[0]}
                content.append(data)
            if len(content) == 0:
                raise ValueError("The CSV file is empty.")

        from extensions.ext_application_services import application_services

        application_services().knowledge.segments.import_segments(
            DatasetRef(tenant_id, dataset_id).document(document_id), actor_id=user_id, values=content
        )
    except Exception:
        redis_client.setex(indexing_cache_key, 600, "error")
        raise

    redis_client.setex(indexing_cache_key, 600, "completed")
    end_at = time.perf_counter()
    logger.info(
        click.style(
            f"Segment batch created job: {job_id} latency: {end_at - start_at}",
            fg="green",
        )
    )
