"""Delete removed Notion documents through the shared document cleanup path."""

import logging
import time

import click
from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.dataset import Dataset
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form
from tasks.clean_document_task import _clean_documents

logger = logging.getLogger(__name__)


@shared_task(
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=5,
    acks_late=True,
    reject_on_worker_lost=True,
)
def clean_notion_document_task(document_ids: list[str], dataset_id: str) -> None:
    """Clean removed Notion documents with the same complete workflow as other sources."""

    unique_document_ids = tuple(dict.fromkeys(document_ids))
    if not unique_document_ids:
        return
    logger.info(click.style(f"Start cleaning removed Notion documents: {dataset_id}", fg="green"))
    started_at = time.perf_counter()

    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if dataset is None:
            raise ValueError("Document has no dataset")
        tenant_id = dataset.tenant_id
        doc_form = get_dataset_doc_form(dataset, session=session)
        if not doc_form:
            raise ValueError("Dataset document form is required")

    _clean_documents(
        document_ids=unique_document_ids,
        dataset_id=dataset_id,
        doc_form=doc_form,
        file_ids=(),
        tenant_id=tenant_id,
        cleanup_manifest=None,
    )

    logger.info(
        click.style(
            f"Cleaned removed Notion documents: {dataset_id} latency: {time.perf_counter() - started_at}",
            fg="green",
        )
    )
