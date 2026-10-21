import logging
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import click
from celery import current_app, shared_task
from sqlalchemy import select, update

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.document_task import DocumentTask
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums import CloudPlan, DeploymentEdition
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.feature_service import FeatureService
from services.knowledge.indexing.adapters.cleanup import build_deletion_index_cleanup, clean_deletion_index
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.cleanup import DeletionIndexCleanup
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError, DocumentIsPausedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskRetriesExhaustedError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from services.knowledge.task_outbox.tenant_queue import knowledge_tenant_task_admission
from tasks.document_execution_recovery import repair_recovered_document_execution
from tasks.document_legacy_conversion import convert_legacy_document_indexing_delivery
from tasks.knowledge_task_outbox_task import knowledge_task_execution

logger = logging.getLogger(__name__)
_LEASE_TIMEOUT_SECONDS = 600
_LOCK_RETRY_DELAY_SECONDS = 10


class CeleryTaskLike(Protocol):
    def delay(self, *args: Any, **kwargs: Any) -> Any: ...

    def apply_async(self, *args: Any, **kwargs: Any) -> Any: ...


@dataclass(frozen=True)
class _DocumentIndexingCandidate:
    ref: DocumentRef
    generation: str | None
    cleanup: DeletionIndexCleanup | None


def _indexing_lock() -> RedisKnowledgeIndexingLock:
    return RedisKnowledgeIndexingLock(redis=redis_client)


def _assert_owned(execution: KnowledgeTaskExecutionLease | None, dataset_lease: KnowledgeIndexingLease) -> None:
    dataset_lease.assert_owned()
    if execution is not None:
        execution.assert_owned()


def _assert_document_owned(
    *,
    execution: KnowledgeTaskExecutionLease | None,
    dataset_lease: KnowledgeIndexingLease,
    document_lease: KnowledgeIndexingLease,
    documents: SQLAlchemyDocumentRepository,
    ref: DocumentRef,
    expected_generation: str | None,
) -> None:
    _assert_owned(execution, dataset_lease)
    document_lease.assert_owned()
    documents.assert_indexing_generation(ref, expected_generation)


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def document_indexing_task(dataset_id: str, document_ids: list):
    """
    Async process document
    :param dataset_id:
    :param document_ids:

    .. warning:: TO BE DEPRECATED
        This function will be deprecated and removed in a future version.
        Use normal_document_indexing_task or priority_document_indexing_task instead.

    Usage: document_indexing_task.delay(dataset_id, document_ids)
    """
    logger.warning("document indexing legacy mode received: %s - %s", dataset_id, document_ids)
    convert_legacy_document_indexing_delivery(dataset_id, document_ids)


def _document_indexing(
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None = None,
    *,
    outbox_id: str | None = None,
    execution: KnowledgeTaskExecutionLease | None = None,
    expected_tenant_id: str | None = None,
) -> None:
    _run_document_indexing_batch(
        dataset_id=dataset_id,
        document_ids=document_ids,
        generations=generations or {},
        outbox_id=outbox_id,
        execution=execution,
        expected_tenant_id=expected_tenant_id,
        replace_existing=False,
        count_pending_vectors=False,
        enforce_vector_space_admission=True,
        queue_summaries=True,
    )


def _run_document_indexing_batch(
    *,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str],
    outbox_id: str | None,
    execution: KnowledgeTaskExecutionLease | None,
    expected_tenant_id: str | None,
    replace_existing: bool,
    count_pending_vectors: bool,
    enforce_vector_space_admission: bool,
    queue_summaries: bool,
) -> None:
    """Run one generation under a renewable dataset lease.

    SQL sessions are limited to snapshots and state transitions. Provider,
    vector, extraction, and broker calls run after those sessions close.
    """

    started_at = time.perf_counter()
    locks = _indexing_lock()
    try:
        with locks.hold(
            dataset_index_lock_name(dataset_id),
            timeout=_LEASE_TIMEOUT_SECONDS,
            blocking_timeout=30,
        ) as dataset_lease:
            _assert_owned(execution, dataset_lease)
            tenant_id = _get_dataset_tenant_id(dataset_id, expected_tenant_id=expected_tenant_id)
            if tenant_id is None:
                logger.info(click.style(f"Dataset is not found: {dataset_id}", fg="yellow"))
                return
            document_repository = SQLAlchemyDocumentRepository(
                session_factory=session_factory.get_session_maker(),
                wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
            )

            try:
                _check_document_creation_limits(
                    tenant_id=tenant_id,
                    document_count=len(document_ids),
                    count_pending_vectors=count_pending_vectors,
                )
            except Exception as error:
                _mark_documents_error(
                    tenant_id=tenant_id,
                    dataset_id=dataset_id,
                    document_ids=document_ids,
                    generations=generations,
                    error=str(error),
                    execution=execution,
                    dataset_lease=dataset_lease,
                )
                if outbox_id is not None:
                    raise
                return

            candidates = _snapshot_indexing_candidates(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_ids=document_ids,
                generations=generations,
                replace_existing=replace_existing,
            )
            externally_touched_ids: set[str] = set()
            for candidate in candidates:
                if candidate.cleanup is None:
                    continue
                with locks.hold(
                    document_index_lock_name(candidate.ref.document_id),
                    timeout=_LEASE_TIMEOUT_SECONDS,
                ) as document_lease:

                    def assert_candidate_owned(
                        ref: DocumentRef = candidate.ref,
                        expected_generation: str | None = candidate.generation,
                    ) -> None:
                        _assert_document_owned(
                            execution=execution,
                            dataset_lease=dataset_lease,
                            document_lease=document_lease,
                            documents=document_repository,
                            ref=ref,
                            expected_generation=expected_generation,
                        )

                    assert_candidate_owned()
                    externally_touched_ids.add(candidate.ref.document_id)
                    try:
                        clean_deletion_index(
                            candidate.cleanup,
                            new_session=session_factory.create_session,
                            assert_owned=assert_candidate_owned,
                        )
                    except DocumentIndexingGenerationChangedError:
                        continue
                    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
                        document_repository.enqueue_current_indexing_repairs(
                            candidate.ref.dataset, [candidate.ref.document_id]
                        )
                        raise

            refs = _persist_parsing_state(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                candidates=candidates,
                execution=execution,
                dataset_lease=dataset_lease,
            )
            if not refs:
                if externally_touched_ids:
                    document_repository.enqueue_current_indexing_repairs(
                        DatasetRef(tenant_id, dataset_id), sorted(externally_touched_ids)
                    )
                return
            stale_touched_ids = externally_touched_ids.difference(ref.document_id for ref in refs)
            if stale_touched_ids:
                document_repository.enqueue_current_indexing_repairs(
                    DatasetRef(tenant_id, dataset_id), sorted(stale_touched_ids)
                )

            indexing_service = build_document_indexing_service(
                session_factory=session_factory.get_session_maker(),
                enforce_vector_space_admission=enforce_vector_space_admission,
            )
            candidates_by_id = {candidate.ref.document_id: candidate for candidate in candidates}
            for ref in refs:
                with locks.hold(
                    document_index_lock_name(ref.document_id),
                    timeout=_LEASE_TIMEOUT_SECONDS,
                ) as document_lease:

                    def assert_document_execution_owned(
                        current_ref: DocumentRef = ref,
                        current_generation: str | None = candidates_by_id[ref.document_id].generation,
                    ) -> None:
                        _assert_document_owned(
                            execution=execution,
                            dataset_lease=dataset_lease,
                            document_lease=document_lease,
                            documents=document_repository,
                            ref=current_ref,
                            expected_generation=current_generation,
                        )

                    assert_document_execution_owned()
                    indexing_execution = DocumentIndexingExecution(
                        expected_generation=candidates_by_id[ref.document_id].generation,
                        assert_owned=assert_document_execution_owned,
                        task_intent_id=execution.intent_id if execution is not None else None,
                        task_execution_id=execution.execution_id if execution is not None else None,
                    )
                    try:
                        indexing_service.run([ref], executions={ref.document_id: indexing_execution})
                        assert_document_execution_owned()
                    except DocumentIndexingGenerationChangedError:
                        document_repository.enqueue_current_indexing_repairs(ref.dataset, [ref.document_id])
                    except (KnowledgeIndexingLeaseLostError, KnowledgeTaskExecutionLeaseLostError):
                        document_repository.enqueue_current_indexing_repairs(ref.dataset, [ref.document_id])
                        raise

            if queue_summaries:
                summary_generations = {candidate.ref.document_id: candidate.generation for candidate in candidates}
                if outbox_id is not None:
                    summary_generations.update(
                        (document_id, generations[document_id])
                        for document_id in document_ids
                        if document_id in generations
                    )
                _queue_summary_indexes(
                    tenant_id=tenant_id,
                    dataset_id=dataset_id,
                    expected_generations=summary_generations,
                    execution=execution,
                    dataset_lease=dataset_lease,
                    documents=document_repository,
                )
            logger.info(
                click.style(f"Processed dataset: {dataset_id} latency: {time.perf_counter() - started_at}", fg="green")
            )
    except DocumentIsPausedError as error:
        logger.info(click.style(str(error), fg="yellow"))
        if outbox_id is not None:
            raise
    except Exception:
        logger.exception("Document indexing task failed, dataset_id: %s", dataset_id)
        if outbox_id is not None:
            raise


def _get_dataset_tenant_id(dataset_id: str, *, expected_tenant_id: str | None) -> str | None:
    with session_factory.create_session() as session:
        conditions = [Dataset.id == dataset_id]
        if expected_tenant_id is not None:
            conditions.append(Dataset.tenant_id == expected_tenant_id)
        return session.scalar(select(Dataset.tenant_id).where(*conditions).limit(1))


def _check_document_creation_limits(*, tenant_id: str, document_count: int, count_pending_vectors: bool) -> None:
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        return
    features = FeatureService.get_features(tenant_id)
    vector_space = features.vector_space
    assert vector_space is not None
    batch_upload_limit = int(dify_config.BATCH_UPLOAD_LIMIT)
    if features.billing.subscription.plan == CloudPlan.SANDBOX and document_count > 1:
        raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
    if document_count > batch_upload_limit:
        raise ValueError(f"You have reached the batch upload limit of {batch_upload_limit}.")
    projected_size = vector_space.size + document_count if count_pending_vectors else vector_space.size
    over_limit = projected_size > vector_space.limit if count_pending_vectors else projected_size >= vector_space.limit
    if vector_space.limit > 0 and over_limit:
        raise ValueError(
            "Your total number of documents plus the number of uploads have over the limit of your subscription."
        )


def _mark_documents_error(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str],
    error: str,
    execution: KnowledgeTaskExecutionLease | None,
    dataset_lease: KnowledgeIndexingLease,
) -> None:
    with session_factory.create_session() as session, session.begin():
        documents = session.scalars(
            select(Document)
            .where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id.in_(document_ids),
            )
            .with_for_update()
        ).all()
        for document in documents:
            if document.id in generations and document.indexing_generation != generations[document.id]:
                continue
            if document.indexing_status in {IndexingStatus.COMPLETED, IndexingStatus.PAUSED} or document.is_paused:
                continue
            document.indexing_status = IndexingStatus.ERROR
            document.error = error
            document.stopped_at = naive_utc_now()
        _assert_owned(execution, dataset_lease)


def _mark_documents_retry_exhausted(
    *,
    tenant_id: str,
    dataset_id: str,
    generations: dict[str, str] | None,
    error: KnowledgeTaskRetriesExhaustedError,
) -> None:
    """Fail only documents still owned by the exhausted intent generations."""

    if not generations:
        return
    error_message = str(error.__cause__ or error)[:4000]
    with session_factory.create_session() as session, session.begin():
        for document_id, generation in generations.items():
            session.execute(
                update(Document)
                .where(
                    Document.tenant_id == tenant_id,
                    Document.dataset_id == dataset_id,
                    Document.id == document_id,
                    Document.indexing_generation == generation,
                    Document.indexing_status.not_in((IndexingStatus.COMPLETED, IndexingStatus.PAUSED)),
                )
                .values(
                    indexing_status=IndexingStatus.ERROR,
                    error=error_message,
                    stopped_at=naive_utc_now(),
                )
            )


def _snapshot_indexing_candidates(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str],
    replace_existing: bool,
) -> tuple[_DocumentIndexingCandidate, ...]:
    with session_factory.create_session() as session:
        dataset = session.scalar(
            select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id).limit(1)
        )
        if dataset is None:
            return ()
        documents = session.scalars(
            select(Document).where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id.in_(document_ids),
            )
        ).all()
        candidates: list[_DocumentIndexingCandidate] = []
        for document in documents:
            if document.id in generations and document.indexing_generation != generations[document.id]:
                continue
            if document.indexing_status in {IndexingStatus.COMPLETED, IndexingStatus.PAUSED} or document.is_paused:
                logger.info("Skipping terminal document indexing delivery for %s", document.id)
                continue
            cleanup = None
            if replace_existing or document.indexing_status != IndexingStatus.WAITING:
                segment_ids = tuple(
                    session.scalars(
                        select(DocumentSegment.id).where(
                            DocumentSegment.tenant_id == tenant_id,
                            DocumentSegment.dataset_id == dataset_id,
                            DocumentSegment.document_id == document.id,
                        )
                    ).all()
                )
                cleanup = build_deletion_index_cleanup(
                    session,
                    dataset=dataset,
                    delete_all=False,
                    segment_ids=segment_ids,
                )
            candidates.append(
                _DocumentIndexingCandidate(
                    ref=DatasetRef(tenant_id, dataset_id).document(document.id),
                    generation=document.indexing_generation,
                    cleanup=cleanup,
                )
            )
        return tuple(candidates)


def _persist_parsing_state(
    *,
    tenant_id: str,
    dataset_id: str,
    candidates: Sequence[_DocumentIndexingCandidate],
    execution: KnowledgeTaskExecutionLease | None,
    dataset_lease: KnowledgeIndexingLease,
) -> tuple[DocumentRef, ...]:
    if not candidates:
        return ()
    candidates_by_id = {candidate.ref.document_id: candidate for candidate in candidates}
    refs: list[DocumentRef] = []
    with session_factory.create_session() as session, session.begin():
        dataset_ref = DatasetRef(tenant_id, dataset_id)
        if lock_dataset_for_child_write(session, dataset_ref) is None:
            return ()
        documents = session.scalars(
            select(Document)
            .where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id.in_(candidates_by_id),
            )
            .with_for_update()
        ).all()
        for document in documents:
            candidate = candidates_by_id[document.id]
            if document.indexing_generation != candidate.generation:
                continue
            if document.indexing_status in {IndexingStatus.COMPLETED, IndexingStatus.PAUSED} or document.is_paused:
                continue
            document.indexing_status = IndexingStatus.PARSING
            document.processing_started_at = naive_utc_now()
            document.error = None
            refs.append(candidate.ref)
        _assert_owned(execution, dataset_lease)
    return tuple(refs)


def _queue_summary_indexes(
    *,
    tenant_id: str,
    dataset_id: str,
    expected_generations: Mapping[str, str | None],
    execution: KnowledgeTaskExecutionLease | None,
    dataset_lease: KnowledgeIndexingLease,
    documents: SQLAlchemyDocumentRepository,
) -> None:
    documents.enqueue_summary_indexes(
        DatasetRef(tenant_id, dataset_id),
        expected_generations,
        assert_owned=lambda: _assert_owned(execution, dataset_lease),
    )


def _document_indexing_with_tenant_queue(
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    task_func: CeleryTaskLike,
    generations: dict[str, str] | None = None,
    *,
    outbox_id: str | None = None,
    execution: KnowledgeTaskExecutionLease | None = None,
) -> None:
    if generations is None and outbox_id is None:
        convert_legacy_document_indexing_delivery(dataset_id, document_ids)
        _advance_legacy_tenant_queue(tenant_id, task_func)
        return
    try:
        _document_indexing(
            dataset_id,
            document_ids,
            generations,
            outbox_id=outbox_id,
            execution=execution,
            expected_tenant_id=tenant_id,
        )
    except Exception:
        logger.exception(
            "Error processing document indexing %s for tenant %s: %s",
            dataset_id,
            tenant_id,
            document_ids,
            exc_info=True,
        )
        raise


def _advance_legacy_tenant_queue(tenant_id: str, task_func: CeleryTaskLike) -> None:
    tenant_isolated_task_queue = TenantIsolatedTaskQueue(tenant_id, "document_indexing")
    next_tasks = tenant_isolated_task_queue.pull_tasks(count=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY)
    logger.info("document indexing tenant isolation queue %s next tasks: %s", tenant_id, next_tasks)
    if not next_tasks:
        tenant_isolated_task_queue.delete_task_key()
        return

    with current_app.producer_or_acquire() as producer:  # type: ignore
        for next_task in next_tasks:
            document_task = DocumentTask(**next_task)
            tenant_isolated_task_queue.set_task_waiting_time()
            task_func.apply_async(
                kwargs={
                    "tenant_id": document_task.tenant_id,
                    "dataset_id": document_task.dataset_id,
                    "document_ids": document_task.document_ids,
                },
                producer=producer,
            )


def _run_document_indexing_delivery(
    *,
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None,
    outbox_id: str | None,
    tenant_queue_receipt: str | None,
    task_func: CeleryTaskLike,
) -> None:
    with knowledge_tenant_task_admission(tenant_id, tenant_queue_receipt) as admission:
        if admission is None:
            return
        try:
            with knowledge_task_execution(outbox_id, assert_admitted=admission.assert_owned) as execution:
                if execution is None:
                    return
                try:
                    documents = SQLAlchemyDocumentRepository(
                        session_factory=session_factory.get_session_maker(),
                        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
                    )
                    if repair_recovered_document_execution(
                        execution,
                        documents=documents,
                        ref=DatasetRef(tenant_id, dataset_id),
                        document_ids=document_ids,
                    ):
                        return
                    if generations is None and outbox_id is None:
                        _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, task_func)
                    else:
                        _document_indexing_with_tenant_queue(
                            tenant_id,
                            dataset_id,
                            document_ids,
                            task_func,
                            generations,
                            outbox_id=outbox_id,
                            execution=execution,
                        )
                except KnowledgeIndexingLockBusyError as error:
                    if outbox_id is None:
                        raise
                    execution.defer(error=str(error), delay_seconds=_LOCK_RETRY_DELAY_SECONDS)
        except KnowledgeTaskRetriesExhaustedError as error:
            _mark_documents_retry_exhausted(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                generations=generations,
                error=error,
            )
            raise


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def normal_document_indexing_task(
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None = None,
    outbox_id: str | None = None,
    tenant_queue_receipt: str | None = None,
) -> None:
    """
    Async process document
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: normal_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("normal document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _run_document_indexing_delivery(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids,
        generations=generations,
        outbox_id=outbox_id,
        tenant_queue_receipt=tenant_queue_receipt,
        task_func=normal_document_indexing_task,
    )


@shared_task(
    queue="priority_dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def priority_document_indexing_task(
    tenant_id: str,
    dataset_id: str,
    document_ids: Sequence[str],
    generations: dict[str, str] | None = None,
    outbox_id: str | None = None,
    tenant_queue_receipt: str | None = None,
) -> None:
    """
    Priority async process document
    :param tenant_id:
    :param dataset_id:
    :param document_ids:

    Usage: priority_document_indexing_task.delay(tenant_id, dataset_id, document_ids)
    """
    logger.info("priority document indexing task received: %s - %s - %s", tenant_id, dataset_id, document_ids)
    _run_document_indexing_delivery(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_ids=document_ids,
        generations=generations,
        outbox_id=outbox_id,
        tenant_queue_receipt=tenant_queue_receipt,
        task_func=priority_document_indexing_task,
    )
