"""Async task for generating summary indexes."""

import logging
import time
from collections.abc import Callable

import click
from celery import shared_task
from sqlalchemy import exists, select, update

from core.credit_usage import CreditUsageCreatedBy
from core.db.session_factory import session_factory
from core.model_context import with_credit_usage_created_by
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.dataset import Document as DatasetDocument
from models.enums import IndexingStatus, SegmentStatus, SummaryStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)


class DocumentSummaryIndexError(RuntimeError):
    """One or more document summaries failed and the durable intent must retry."""


@shared_task(
    queue="dataset_summary",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(DocumentSummaryIndexError,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
@with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
def generate_summary_index_task(
    dataset_id: str,
    document_id: str,
    segment_ids: list[str] | None = None,
    outbox_id: str | None = None,
    expected_generation: str | None = None,
    enforce_generation: bool = False,
    expected_indexing_technique: str | None = None,
    expected_embedding_model_provider: str | None = None,
    expected_embedding_model: str | None = None,
    expected_summary_index_setting: dict[str, object] | None = None,
) -> None:
    """
    Async generate summary index for document segments.

    Args:
        dataset_id: Dataset ID
        document_id: Document ID
        segment_ids: Optional list of specific segment IDs to process. If None, process all segments.
        outbox_id: Durable execution intent. Older untracked deliveries are converted to current durable work.
        expected_generation: Document indexing generation owned by this delivery.
        enforce_generation: Compare the generation even when the expected value is NULL.
        expected_indexing_technique: Dataset index mode owned by this delivery.
        expected_embedding_model_provider: Embedding provider owned by this delivery.
        expected_embedding_model: Embedding model owned by this delivery.
        expected_summary_index_setting: Summary model configuration owned by this delivery.

    Usage:
        Current producers publish this task through the knowledge task outbox.
    """
    if outbox_id is None and expected_generation is None and not enforce_generation:
        repaired = _enqueue_current_document_summary_repair(dataset_id=dataset_id, document_id=document_id)
        logger.info(
            "Legacy document summary delivery reconciled document_id=%s repaired=%s",
            document_id,
            repaired,
        )
        return

    logger.info(
        click.style(
            f"Start generating summary index for document {document_id} in dataset {dataset_id}",
            fg="green",
        )
    )
    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        execution.assert_owned()
        if execution.recovered_execution:
            repaired = _enqueue_current_document_summary_repair(
                dataset_id=dataset_id,
                document_id=document_id,
                checkpoint_source_intent_id=outbox_id,
            )
            logger.warning(
                "Recovered document summary execution scheduled current repair document_id=%s repaired=%s",
                document_id,
                repaired,
            )
            return
        generation_fenced = outbox_id is not None or expected_generation is not None or enforce_generation
        try:
            _generate_document_summaries(
                dataset_id=dataset_id,
                document_id=document_id,
                segment_ids=segment_ids,
                expected_generation=expected_generation,
                enforce_generation=generation_fenced,
                assert_execution_owned=execution.assert_owned,
                task_intent_id=execution.intent_id,
                task_execution_id=execution.execution_id,
                expected_indexing_technique=expected_indexing_technique,
                expected_embedding_model_provider=expected_embedding_model_provider,
                expected_embedding_model=expected_embedding_model,
                expected_summary_index_setting=expected_summary_index_setting,
            )
        except Exception as error:
            logger.exception("Failed to generate summary index for document %s", document_id)
            if outbox_id is not None:
                raise
            _record_summary_generation_error(
                dataset_id=dataset_id,
                document_id=document_id,
                segment_ids=segment_ids,
                expected_generation=expected_generation,
                enforce_generation=generation_fenced,
                error=error,
            )


def _enqueue_current_document_summary_repair(
    *,
    dataset_id: str,
    document_id: str,
    checkpoint_source_intent_id: str | None = None,
) -> int:
    with session_factory.create_session() as session:
        owner = session.execute(
            select(Dataset.tenant_id, Dataset.id).where(Dataset.id == dataset_id).limit(1)
        ).one_or_none()
    if owner is None:
        return 0
    documents = SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    return documents.repair_completed_summary_intents(
        DatasetRef(owner.tenant_id, owner.id),
        (document_id,),
        force_successor=True,
        checkpoint_source_intent_id=checkpoint_source_intent_id,
    )


def _generate_document_summaries(
    *,
    dataset_id: str,
    document_id: str,
    segment_ids: list[str] | None,
    expected_generation: str | None,
    enforce_generation: bool,
    assert_execution_owned: Callable[[], None],
    task_intent_id: str | None,
    task_execution_id: str | None,
    expected_indexing_technique: str | None,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
    expected_summary_index_setting: dict[str, object] | None,
) -> None:
    start_at = time.perf_counter()
    assert_execution_owned()
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if not dataset:
            logger.info("Skipping summary generation for deleted dataset %s", dataset_id)
            return

        if task_intent_id is not None and expected_indexing_technique is None:
            raise ValueError("Durable document summary delivery is missing its model configuration")
        if expected_indexing_technique is None:
            expected_indexing_technique = str(dataset.indexing_technique)
            expected_embedding_model_provider = dataset.embedding_model_provider
            expected_embedding_model = dataset.embedding_model
            expected_summary_index_setting = (
                dict(dataset.summary_index_setting) if dataset.summary_index_setting is not None else None
            )
        elif (
            str(dataset.indexing_technique) != expected_indexing_technique
            or dataset.embedding_model_provider != expected_embedding_model_provider
            or dataset.embedding_model != expected_embedding_model
            or dataset.summary_index_setting != expected_summary_index_setting
        ):
            logger.info("Skipping stale summary model configuration for document %s", document_id)
            return

        document_conditions = [
            DatasetDocument.id == document_id,
            DatasetDocument.dataset_id == dataset.id,
            DatasetDocument.tenant_id == dataset.tenant_id,
        ]
        if enforce_generation:
            document_conditions.append(DatasetDocument.indexing_generation == expected_generation)
        document = session.scalar(select(DatasetDocument).where(*document_conditions))
        if not document:
            logger.info("Skipping deleted or stale summary document %s", document_id)
            return

        if (
            not document.need_summary
            or document.indexing_status != IndexingStatus.COMPLETED
            or not document.enabled
            or document.archived
            or document.is_paused
        ):
            logger.info(
                click.style(
                    f"Skipping summary generation for ineligible document {document_id}",
                    fg="cyan",
                )
            )
            return

        # Only generate summary index for high_quality indexing technique
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            logger.info(
                click.style(
                    f"Skipping summary generation for dataset {dataset_id}: "
                    f"indexing_technique is {dataset.indexing_technique}, not 'high_quality'",
                    fg="cyan",
                )
            )
            return

        # Check if summary index is enabled
        summary_index_setting = dataset.summary_index_setting
        if not summary_index_setting or not summary_index_setting.get("enable"):
            logger.info(
                click.style(
                    f"Summary index is disabled for dataset {dataset_id}",
                    fg="cyan",
                )
            )
            return

        # Determine if only parent chunks should be processed
        only_parent_chunks = dataset.chunk_structure == "parent_child_index"

        # Release the read transaction before the adapter invokes models and vector storage.
        session.commit()
    summary_records = SummaryIndexAdapter.generate_summaries_for_document(
        dataset=dataset,
        document=document,
        summary_index_setting=summary_index_setting,
        segment_ids=segment_ids,
        only_parent_chunks=only_parent_chunks,
        expected_document_generation=expected_generation,
        enforce_document_generation=enforce_generation,
        task_intent_id=task_intent_id,
        task_execution_id=task_execution_id,
        expected_indexing_technique=expected_indexing_technique,
        expected_embedding_model_provider=expected_embedding_model_provider,
        expected_embedding_model=expected_embedding_model,
        expected_summary_index_setting=expected_summary_index_setting,
        assert_owned=assert_execution_owned,
    )
    failed_summary_ids = _failed_summary_ids(
        dataset_id=dataset_id,
        document_id=document_id,
        segment_ids=segment_ids,
    )
    if failed_summary_ids:
        raise DocumentSummaryIndexError(f"{len(failed_summary_ids)} summary indexes failed for document {document_id}")
    assert_execution_owned()

    end_at = time.perf_counter()
    logger.info(
        click.style(
            f"Summary index generation completed for document {document_id}: "
            f"{len(summary_records)} summaries generated, latency: {end_at - start_at}",
            fg="green",
        )
    )


def _failed_summary_ids(*, dataset_id: str, document_id: str, segment_ids: list[str] | None) -> list[str]:
    statement = (
        select(DocumentSegmentSummary.chunk_id)
        .join(DocumentSegment, DocumentSegment.id == DocumentSegmentSummary.chunk_id)
        .where(
            DocumentSegmentSummary.dataset_id == dataset_id,
            DocumentSegmentSummary.document_id == document_id,
            DocumentSegmentSummary.status == SummaryStatus.ERROR,
            DocumentSegment.dataset_id == dataset_id,
            DocumentSegment.document_id == document_id,
            DocumentSegment.status == SegmentStatus.COMPLETED,
            DocumentSegment.enabled.is_(True),
        )
    )
    if segment_ids:
        statement = statement.where(DocumentSegmentSummary.chunk_id.in_(segment_ids))
    with session_factory.create_session() as session:
        return list(session.scalars(statement))


def _record_summary_generation_error(
    *,
    dataset_id: str,
    document_id: str,
    segment_ids: list[str] | None,
    expected_generation: str | None,
    enforce_generation: bool,
    error: Exception,
) -> None:
    if not segment_ids:
        return
    document_is_current = exists().where(
        DatasetDocument.id == document_id,
        DatasetDocument.dataset_id == dataset_id,
        *((DatasetDocument.indexing_generation == expected_generation,) if enforce_generation else ()),
    )
    with session_factory.create_session() as session, session.begin():
        session.execute(
            update(DocumentSegment)
            .where(
                DocumentSegment.id.in_(segment_ids),
                DocumentSegment.dataset_id == dataset_id,
                DocumentSegment.document_id == document_id,
                document_is_current,
            )
            .values(error=f"Summary generation failed: {error}")
        )
