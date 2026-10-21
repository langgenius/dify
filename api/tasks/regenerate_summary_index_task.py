"""Task for regenerating summary indexes when dataset settings change."""

import logging
import time
from functools import partial

import click
from celery import shared_task

from core.credit_usage import CreditUsageCreatedBy
from core.db.session_factory import session_factory
from core.model_context import with_credit_usage_created_by
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from models.dataset import Dataset
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.summary_repository import SQLAlchemySummaryRepository, load_summary_regeneration_targets
from services.api_token_service import ApiTokenCache
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.knowledge.summaries.application import SummaryVectorInput, SummaryWriteFence
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)


class SummaryIndexRegenerationError(RuntimeError):
    """One or more summary records failed and the durable intent must be retried."""


@shared_task(
    queue="dataset_summary",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(SummaryIndexRegenerationError,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
@with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
def regenerate_summary_index_task(
    dataset_id: str,
    regenerate_reason: str = "summary_model_changed",
    regenerate_vectors_only: bool = False,
    expected_indexing_technique: str | None = None,
    expected_embedding_model_provider: str | None = None,
    expected_embedding_model: str | None = None,
    outbox_id: str | None = None,
    expected_summary_index_setting: dict[str, object] | None = None,
) -> None:
    if (
        outbox_id is None
        and expected_indexing_technique is None
        and expected_embedding_model_provider is None
        and expected_embedding_model is None
    ):
        repaired = _dataset_repository().enqueue_current_summary_repair(
            dataset_id,
            regenerate_reason=regenerate_reason,
            regenerate_vectors_only=regenerate_vectors_only,
        )
        logger.info(
            "Legacy dataset summary delivery reconciled dataset_id=%s repaired=%s",
            dataset_id,
            repaired,
        )
        return

    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        execution.assert_owned()
        if execution.recovered_execution:
            _enqueue_current_summary_repair(
                dataset_id=dataset_id,
                regenerate_reason=regenerate_reason,
                regenerate_vectors_only=regenerate_vectors_only,
                checkpoint_source_intent_id=outbox_id,
            )
            logger.warning("Recovered dataset summary execution scheduled current repair dataset_id=%s", dataset_id)
            return
        _run_summary_index_task(
            dataset_id=dataset_id,
            regenerate_reason=regenerate_reason,
            regenerate_vectors_only=regenerate_vectors_only,
            expected_indexing_technique=expected_indexing_technique,
            expected_embedding_model_provider=expected_embedding_model_provider,
            expected_embedding_model=expected_embedding_model,
            expected_summary_index_setting=expected_summary_index_setting,
            execution=execution,
        )


def _run_summary_index_task(
    *,
    dataset_id: str,
    regenerate_reason: str,
    regenerate_vectors_only: bool,
    expected_indexing_technique: str | None,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
    expected_summary_index_setting: dict[str, object] | None,
    execution: KnowledgeTaskExecutionLease,
) -> None:
    execution.assert_owned()
    if execution.intent_id is not None and expected_indexing_technique is None:
        raise ValueError("Durable dataset summary delivery is missing its model configuration")
    state_matched = _regenerate_summary_index(
        dataset_id=dataset_id,
        regenerate_reason=regenerate_reason,
        regenerate_vectors_only=regenerate_vectors_only,
        expected_indexing_technique=expected_indexing_technique,
        expected_embedding_model_provider=expected_embedding_model_provider,
        expected_embedding_model=expected_embedding_model,
        expected_summary_index_setting=expected_summary_index_setting,
        execution=execution,
    )
    if not state_matched:
        logger.warning("Stale summary delivery scheduled current-state repair: %s", dataset_id)
        _enqueue_current_summary_repair(
            dataset_id=dataset_id,
            regenerate_reason=regenerate_reason,
            regenerate_vectors_only=regenerate_vectors_only,
        )


def _regenerate_summary_index(
    *,
    dataset_id: str,
    regenerate_reason: str,
    regenerate_vectors_only: bool,
    expected_indexing_technique: str | None,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
    expected_summary_index_setting: dict[str, object] | None,
    execution: KnowledgeTaskExecutionLease,
) -> bool:
    """
    Regenerate summary indexes for all documents in a dataset.

    This task is triggered when:
    1. summary_index_setting model changes (regenerate_reason="summary_model_changed")
       - Regenerates summary content and vectors for all existing summaries
    2. embedding_model changes (regenerate_reason="embedding_model_changed")
       - Only regenerates vectors for existing summaries (keeps summary content)

    Args:
        dataset_id: Dataset ID
        regenerate_reason: Reason for regeneration ("summary_model_changed" or "embedding_model_changed")
        regenerate_vectors_only: If True, only regenerate vectors without regenerating summary content
    """
    logger.info(
        click.style(
            f"Start regenerate summary index for dataset {dataset_id}, reason: {regenerate_reason}",
            fg="green",
        )
    )
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        loaded = load_summary_regeneration_targets(
            session,
            dataset_id=dataset_id,
            regenerate_vectors_only=regenerate_vectors_only,
        )
        if loaded is None:
            logger.info("Skipping summary regeneration for deleted dataset %s", dataset_id)
            return True
        dataset, targets = loaded
        if not _matches_expected_state(
            dataset,
            expected_indexing_technique=expected_indexing_technique,
            expected_embedding_model_provider=expected_embedding_model_provider,
            expected_embedding_model=expected_embedding_model,
            expected_summary_index_setting=expected_summary_index_setting,
        ):
            logger.info("Skipping stale summary index intent for %s", dataset_id)
            return False
        if dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY:
            return True
        summary_index_setting = dataset.summary_index_setting
        if not regenerate_vectors_only and not (summary_index_setting and summary_index_setting.get("enable") is True):
            return True
        session.commit()

    store = SQLAlchemySummaryRepository(new_session=session_factory.create_session)
    total_segments_processed = 0
    total_segments_failed = 0
    for target in targets:
        segment, summary_record = target.segment, target.summary
        fence = SummaryWriteFence(
            expected_document_generation=target.document_generation,
            enforce_document_generation=True,
            expected_segment_generation=segment.indexing_generation,
            enforce_segment_generation=True,
            task_intent_id=execution.intent_id,
            task_execution_id=execution.execution_id,
            expected_indexing_technique=expected_indexing_technique,
            expected_embedding_model_provider=expected_embedding_model_provider,
            expected_embedding_model=expected_embedding_model,
            expected_summary_index_setting=expected_summary_index_setting,
            enforce_summary_index_setting=True,
        )
        command = SummaryVectorInput(
            DatasetRef(dataset.tenant_id, dataset.id).document(segment.document_id).segment(segment.id),
            summary_record.id,
            summary_record.summary_content or "",
            summary_record.summary_index_node_id,
            fence,
        )
        try:
            execution.assert_owned()
            checkpoint = store.checkpoint(command)
            if checkpoint.was_completed(command):
                continue
            if regenerate_vectors_only:
                SummaryIndexAdapter.vectorize_summary(summary_record, segment, dataset, fence=fence)
            else:
                assert summary_index_setting is not None
                with session_factory.create_session() as segment_session:
                    SummaryIndexAdapter.generate_and_vectorize_summary(
                        segment,
                        dataset,
                        summary_index_setting,
                        session=segment_session,
                        fence=fence,
                        reuse_generated_content=checkpoint.was_generated(command),
                    )
            execution.assert_owned()
            total_segments_processed += 1
        except KnowledgeTaskExecutionLeaseLostError:
            raise
        except Exception:
            logger.exception("Failed to regenerate summary for segment %s", segment.id)
            total_segments_failed += 1

    logger.info(
        click.style(
            f"Summary regeneration completed for dataset {dataset_id}: "
            f"{total_segments_processed} segments processed, {total_segments_failed} failed, "
            f"latency: {time.perf_counter() - start_at:.2f}s",
            fg="green",
        )
    )
    if total_segments_failed:
        raise SummaryIndexRegenerationError(
            f"Failed to regenerate {total_segments_failed} summary indexes for dataset {dataset_id}"
        )
    return True


def _matches_expected_state(
    dataset: Dataset,
    *,
    expected_indexing_technique: str | None,
    expected_embedding_model_provider: str | None,
    expected_embedding_model: str | None,
    expected_summary_index_setting: dict[str, object] | None,
) -> bool:
    return (
        expected_indexing_technique is None
        or (
            str(dataset.indexing_technique) == expected_indexing_technique
            and dataset.embedding_model_provider == expected_embedding_model_provider
            and dataset.embedding_model == expected_embedding_model
        )
    ) and dataset.summary_index_setting == expected_summary_index_setting


def _enqueue_current_summary_repair(
    *,
    dataset_id: str,
    regenerate_reason: str,
    regenerate_vectors_only: bool,
    checkpoint_source_intent_id: str | None = None,
) -> None:
    _dataset_repository().enqueue_current_summary_repair(
        dataset_id,
        regenerate_reason=regenerate_reason,
        regenerate_vectors_only=regenerate_vectors_only,
        force_successor=True,
        checkpoint_source_intent_id=checkpoint_source_intent_id,
    )


def _dataset_repository() -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
    )
