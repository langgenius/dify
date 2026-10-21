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
from machinery.context import RequestContext
from models.dataset import Dataset, Document
from models.model import UploadFile
from services.knowledge.segments.batch_status import transition_batch_to_terminal

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
) -> None:
    try:
        _create_batch_segments(
            job_id=job_id,
            upload_file_id=upload_file_id,
            dataset_id=dataset_id,
            document_id=document_id,
            tenant_id=tenant_id,
            user_id=user_id,
        )
    except Exception:
        logger.exception("Segments batch created index failed")
        transition_batch_to_terminal(redis_client, job_id, "error")
        return


def _create_batch_segments(
    *,
    job_id: str,
    upload_file_id: str,
    dataset_id: str,
    document_id: str,
    tenant_id: str,
    user_id: str,
) -> None:
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

    with session_factory.create_session() as session:
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

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            raise ValueError("Document is not available.")

        upload_file = session.scalar(
            select(UploadFile).where(UploadFile.id == upload_file_id, UploadFile.tenant_id == tenant_id)
        )
        if not upload_file:
            raise ValueError("UploadFile not found.")

        doc_form = str(dataset_document.doc_form)
        upload_file_key = upload_file.key

    with tempfile.TemporaryDirectory() as temp_dir:
        suffix = Path(upload_file_key).suffix
        file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"  # type: ignore
        storage.download(upload_file_key, file_path)

        df = pd.read_csv(file_path, dtype=str, keep_default_na=False)
        content: list[dict[str, object]] = []
        for _, row in df.iterrows():
            if doc_form == IndexStructureType.QA_INDEX:
                data = {"content": row.iloc[0], "answer": row.iloc[1]}
            else:
                data = {"content": row.iloc[0]}
            content.append(data)
        if len(content) == 0:
            raise ValueError("The CSV file is empty.")

    # The registry imports this task while assembling the batch dispatcher.
    from extensions.ext_application_services import application_services

    application_services().knowledge.segments.create_imported_segments(
        RequestContext(
            request_id=job_id,
            trace_id=None,
            account_id=user_id,
            active_workspace_id=tenant_id,
        ),
        dataset_id=dataset_id,
        document_id=document_id,
        values=content,
        job_id=job_id,
    )
    end_at = time.perf_counter()
    logger.info(
        click.style(
            f"Segment batch created job: {job_id} latency: {end_at - start_at}",
            fg="green",
        )
    )
