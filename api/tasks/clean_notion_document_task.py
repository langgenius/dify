"""Drain legacy Notion cleanup messages through the shared cleanup path."""

import logging
import time

import click
from celery import Task, shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from models.dataset import Dataset, Document
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form
from services.knowledge.indexing.adapters.cleanup import document_cleanup_batches, hold_document_cleanup_locks
from services.knowledge.indexing.locks import KnowledgeIndexingLockBusyError
from tasks.clean_document_task import _clean_documents, _resolve_tenant_id

logger = logging.getLogger(__name__)


def _prepare_legacy_notion_cleanup(
    document_ids: tuple[str, ...],
    dataset_id: str,
    *,
    tenant_id: str | None,
) -> str:
    """Hide existing documents while retaining their file evidence for retry."""

    with session_factory.create_session() as session, session.begin():
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        statement = (
            select(Document)
            .where(
                Document.dataset_id == dataset_id,
                Document.id.in_(document_ids),
            )
            .order_by(Document.id)
            .with_for_update(of=Document)
            .execution_options(populate_existing=True)
        )
        if tenant_id is not None:
            statement = statement.where(Document.tenant_id == tenant_id)
        documents = list(session.scalars(statement).all())

        doc_form = get_dataset_doc_form(dataset, session=session) if dataset is not None else None
        if not doc_form and documents:
            doc_form = str(documents[0].doc_form)
        for document in documents:
            document.enabled = False
            document.archived = True
        return doc_form or "text_model"


@shared_task(
    bind=True,
    queue="dataset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=None,
    dont_autoretry_for=(ValueError,),
    acks_late=True,
    reject_on_worker_lost=True,
)
def clean_notion_document_task(
    self: Task,
    document_ids: list[str],
    dataset_id: str,
) -> None:
    """Clean removed Notion documents using the original two-field message."""

    unique_document_ids = tuple(dict.fromkeys(document_ids))
    if not unique_document_ids:
        return
    logger.info(click.style(f"Start cleaning removed Notion documents: {dataset_id}", fg="green"))
    started_at = time.perf_counter()

    tenant_id = _resolve_tenant_id(
        dataset_id=dataset_id,
        document_ids=unique_document_ids,
        file_ids=(),
    )

    try:
        for batch in document_cleanup_batches(unique_document_ids):
            with hold_document_cleanup_locks(batch) as leases:
                doc_form = _prepare_legacy_notion_cleanup(
                    batch,
                    dataset_id,
                    tenant_id=tenant_id,
                )
                _clean_documents(
                    document_ids=batch,
                    dataset_id=dataset_id,
                    doc_form=doc_form,
                    file_ids=(),
                    owned_leases=leases,
                )
    except KnowledgeIndexingLockBusyError as error:
        raise self.retry(exc=error, countdown=60, max_retries=None) from error

    logger.info(
        click.style(
            f"Cleaned removed Notion documents: {dataset_id} latency: {time.perf_counter() - started_at}",
            fg="green",
        )
    )
