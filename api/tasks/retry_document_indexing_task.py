import logging
import time
from collections.abc import Callable
from contextlib import ExitStack
from uuid import uuid4

import click
from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.db.session_factory import get_session_maker, session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from enums import DeploymentEdition
from extensions.application_services.data_sources import build_data_source_credentials
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models import Account, Tenant
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus
from repositories.knowledge.dataset_repository import lock_dataset_for_child_write
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.rag_pipeline_repository import SQLAlchemyRagPipelineRepository
from repositories.knowledge.segment_repository import (
    SQLAlchemySegmentAttachmentWriter,
    delete_document_segments_for_replacement,
    enqueue_upload_file_cleanup,
)
from services.feature_service import FeatureService
from services.knowledge.documents.contracts import DocumentIndexingExecutionClaimLostError
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.rag_pipeline.adapters import SQLAlchemyPipelineRunPreparer
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskDeliveryHandledError,
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from services.workflow_run_agg import WorkflowRunAgg
from tasks.document_legacy_conversion import convert_legacy_document_indexing_delivery
from tasks.knowledge_task_outbox_task import defer_knowledge_task_before_execution, knowledge_task_execution

logger = logging.getLogger(__name__)
_LEASE_TIMEOUT_SECONDS = 600
_LOCK_RETRY_DELAY_SECONDS = 10


def _noop_ownership_check() -> None:
    return None


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def retry_document_indexing_task(
    dataset_id: str,
    document_ids: list[str],
    user_id: str,
    lock_tokens: dict[str, str] | None = None,
    generations: dict[str, str] | None = None,
    repair: bool = False,
    outbox_id: str | None = None,
) -> None:
    """Retry document indexing under dataset and per-document renewable leases."""
    if generations is None and outbox_id is None:
        convert_legacy_document_indexing_delivery(dataset_id, document_ids, actor_id=user_id)
        return
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    lock_tokens = lock_tokens or {}
    try:
        with ExitStack() as stack:
            dataset_lease = stack.enter_context(
                locks.hold(
                    dataset_index_lock_name(dataset_id),
                    timeout=_LEASE_TIMEOUT_SECONDS,
                    blocking_timeout=30,
                )
            )
            document_leases = {
                document_id: stack.enter_context(
                    locks.hold(
                        document_index_lock_name(document_id),
                        timeout=_LEASE_TIMEOUT_SECONDS,
                        expected_token=lock_tokens.get(document_id),
                    )
                )
                for document_id in sorted(set(document_ids))
            }
            with knowledge_task_execution(outbox_id) as execution:
                if execution is None:
                    return
                if execution.recovered_execution:
                    _enqueue_current_document_repairs(
                        dataset_id=dataset_id,
                        document_ids=document_ids,
                        user_id=user_id,
                    )
                    return

                def assert_execution_owned() -> None:
                    execution.assert_owned()
                    dataset_lease.assert_owned()

                assert_execution_owned()
                _run_document_retry(
                    dataset_id,
                    document_ids,
                    user_id,
                    generations,
                    repair,
                    dataset_lease=dataset_lease,
                    document_leases=document_leases,
                    assert_execution_owned=assert_execution_owned,
                    task_intent_id=execution.intent_id,
                    task_execution_id=execution.execution_id,
                )
    except KnowledgeIndexingLockBusyError as error:
        if outbox_id is None:
            raise
        if not defer_knowledge_task_before_execution(outbox_id, error=str(error), delay=_LOCK_RETRY_DELAY_SECONDS):
            logger.info("Skipping duplicate or terminal document retry delivery: %s", outbox_id)
            return
        raise KnowledgeTaskRequeuedError(
            f"document retry {outbox_id} was deferred while its indexing lock is held"
        ) from error
    except KnowledgeIndexingLeaseLostError:
        logger.exception("Document retry lost an indexing lease; scheduling convergence repair: %s", dataset_id)
        _enqueue_current_document_repairs(dataset_id=dataset_id, document_ids=document_ids, user_id=user_id)


def _run_document_retry(
    dataset_id: str,
    document_ids: list[str],
    user_id: str,
    generations: dict[str, str] | None,
    repair: bool,
    *,
    dataset_lease: KnowledgeIndexingLease,
    document_leases: dict[str, KnowledgeIndexingLease],
    assert_execution_owned: Callable[[], None],
    task_intent_id: str | None = None,
    task_execution_id: str | None = None,
) -> None:

    started_at = time.perf_counter()
    generations = generations or {}
    try:
        stale_document_ids = _retry_documents(
            dataset_id=dataset_id,
            document_ids=document_ids,
            user_id=user_id,
            generations=generations,
            repair=repair,
            dataset_lease=dataset_lease,
            document_leases=document_leases,
            assert_execution_owned=assert_execution_owned,
            task_intent_id=task_intent_id,
            task_execution_id=task_execution_id,
        )
        if stale_document_ids:
            logger.warning(
                "Stale document retry deliveries may have completed external work; scheduling repairs: %s",
                stale_document_ids,
            )
            _enqueue_current_document_repairs(
                dataset_id=dataset_id,
                document_ids=stale_document_ids,
                user_id=user_id,
            )
    except KnowledgeIndexingLeaseLostError:
        logger.exception("Document retry lost its dataset lease; scheduling convergence repair: %s", dataset_id)
        _enqueue_current_document_repairs(dataset_id=dataset_id, document_ids=document_ids, user_id=user_id)
    except (DocumentIndexingExecutionClaimLostError, DocumentIndexingGenerationChangedError):
        logger.info("Document retry execution changed after external work; scheduling convergence repair")
        _enqueue_current_document_repairs(dataset_id=dataset_id, document_ids=document_ids, user_id=user_id)
    except KnowledgeTaskExecutionLeaseLostError:
        _enqueue_current_document_repairs(dataset_id=dataset_id, document_ids=document_ids, user_id=user_id)
        raise
    logger.info(click.style(f"Retry dataset: {dataset_id} latency: {time.perf_counter() - started_at}", fg="green"))


def _retry_documents(
    *,
    dataset_id: str,
    document_ids: list[str],
    user_id: str,
    generations: dict[str, str],
    repair: bool,
    dataset_lease: KnowledgeIndexingLease,
    document_leases: dict[str, KnowledgeIndexingLease],
    assert_execution_owned: Callable[[], None],
    task_intent_id: str | None = None,
    task_execution_id: str | None = None,
) -> list[str]:
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if dataset is None:
            logger.info(click.style(f"Dataset not found: {dataset_id}", fg="red"))
            return []
        user = session.scalar(select(Account).where(Account.id == user_id).limit(1))
        if user is None:
            logger.info(click.style(f"User not found: {user_id}", fg="red"))
            return []
        tenant = session.scalar(select(Tenant).where(Tenant.id == dataset.tenant_id).limit(1))
        if tenant is None:
            raise ValueError("Tenant not found")
        user.set_current_tenant_with_session(tenant, session=session)

        stale_document_ids: list[str] = []
        for document_id in document_ids:
            document_lease = document_leases[document_id]
            state_matched = _retry_document(
                session=session,
                dataset=dataset,
                user=user,
                document_id=document_id,
                expected_generation=generations.get(document_id),
                repair=repair,
                dataset_lease=dataset_lease,
                document_lease=document_lease,
                assert_execution_owned=assert_execution_owned,
                task_intent_id=task_intent_id,
                task_execution_id=task_execution_id,
            )
            if not state_matched:
                stale_document_ids.append(document_id)
        return stale_document_ids


def _retry_document(
    *,
    session: Session,
    dataset: Dataset,
    user: Account,
    document_id: str,
    expected_generation: str | None,
    repair: bool,
    dataset_lease: KnowledgeIndexingLease,
    document_lease: KnowledgeIndexingLease,
    assert_execution_owned: Callable[[], None] = _noop_ownership_check,
    task_intent_id: str | None = None,
    task_execution_id: str | None = None,
) -> bool:
    document = session.scalar(
        select(Document)
        .where(
            Document.id == document_id,
            Document.dataset_id == dataset.id,
            Document.tenant_id == dataset.tenant_id,
        )
        .limit(1)
    )
    if document is None:
        logger.info(click.style(f"Document not found: {document_id}", fg="yellow"))
        return True
    observed_generation = _generation(document)
    if expected_generation is not None and observed_generation != expected_generation:
        logger.info("Skipping stale document retry generation for %s", document_id)
        return False
    if _document_retry_is_terminal(document):
        logger.info("Skipping duplicate document retry for %s in status %s", document_id, document.indexing_status)
        return True

    # A previous delivery may have committed PARSING and then lost its worker.
    # Once both leases are acquired, resume the same generation from its source.
    repair = repair or document.indexing_status != IndexingStatus.WAITING

    execution_documents = SQLAlchemyDocumentRepository(session_factory=session_factory.get_session_maker())
    if repair:
        document_ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
        if lock_dataset_for_child_write(session, document_ref.dataset) is None:
            return False
        document = session.scalar(
            select(Document)
            .where(
                Document.id == document_id,
                Document.dataset_id == dataset.id,
                Document.tenant_id == dataset.tenant_id,
                Document.indexing_generation == observed_generation,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if document is None:
            session.rollback()
            return False
        if _document_retry_is_terminal(document):
            session.rollback()
            return True
        document.indexing_status = IndexingStatus.WAITING
        document.error = None
        if expected_generation is None:
            source_generation = _generation(document)
            successor_generation = str(uuid4())
            if dataset.runtime_mode == "rag_pipeline":
                SQLAlchemyRagPipelineRepository.copy_document_pipeline_execution_binding(
                    session,
                    tenant_id=document.tenant_id,
                    dataset_id=document.dataset_id,
                    document_id=document.id,
                    source_generation=source_generation,
                    target_generation=successor_generation,
                )
            document.processing_started_at = naive_utc_now()
            document.indexing_generation = successor_generation
            document.indexing_execution_id = None
            expected_generation = _generation(document)
        session.add(document)
        assert_execution_owned()
        dataset_lease.assert_owned()
        document_lease.assert_owned()

        def assert_phase_owned() -> None:
            assert_execution_owned()
            dataset_lease.assert_owned()
            document_lease.assert_owned()

        phase_execution = DocumentIndexingExecution(
            expected_generation,
            assert_phase_owned,
            task_intent_id=task_intent_id,
            task_execution_id=task_execution_id,
        )
        execution_documents.commit_indexing_phase(session, document_ref, execution=phase_execution)
    elif expected_generation is None:
        expected_generation = _generation(document)

    document_ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
    pipeline_execution_id: str | None = None
    if dataset.runtime_mode == "rag_pipeline":
        pipeline_execution_id = str(uuid4())
        if not execution_documents.claim_pipeline_indexing_execution(
            document_ref,
            execution_id=pipeline_execution_id,
            expected_generation=expected_generation,
        ):
            return False

    def assert_document_execution_owned() -> None:
        assert_execution_owned()
        dataset_lease.assert_owned()
        document_lease.assert_owned()
        if pipeline_execution_id is None:
            execution_documents.assert_indexing_generation(document_ref, expected_generation)
        else:
            execution_documents.assert_pipeline_indexing_execution(
                document_ref,
                execution_id=pipeline_execution_id,
                expected_generation=expected_generation,
            )

    indexing_execution = DocumentIndexingExecution(
        expected_generation=expected_generation,
        assert_owned=assert_document_execution_owned,
        execution_id=pipeline_execution_id,
        task_intent_id=task_intent_id,
        task_execution_id=task_execution_id,
    )

    def commit_document_phase() -> None:
        execution_documents.commit_indexing_phase(
            session,
            document_ref,
            execution=indexing_execution,
        )

    try:
        assert_document_execution_owned()
        _check_vector_space(dataset)
        assert_document_execution_owned()
        logger.info(click.style(f"Start retry document: {document_id}", fg="green"))
        assert_document_execution_owned()

        index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()
        segments = session.scalars(
            select(DocumentSegment).where(
                DocumentSegment.tenant_id == dataset.tenant_id,
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.document_id == document_id,
            )
        ).all()
        if segments:
            index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
            assert_document_execution_owned()
            index_processor.clean(
                dataset,
                index_node_ids,
                with_keywords=True,
                delete_child_chunks=False,
                session=session,
            )
            assert_document_execution_owned()
            commit_document_phase()

        assert_document_execution_owned()
        if lock_dataset_for_child_write(session, document_ref.dataset) is None:
            return False
        document = session.scalar(
            select(Document)
            .where(
                Document.id == document_id,
                Document.dataset_id == dataset.id,
                Document.tenant_id == dataset.tenant_id,
                Document.indexing_generation == expected_generation,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if document is None:
            session.rollback()
            return False
        cleanup_file_ids = delete_document_segments_for_replacement(session, document_ref)
        if enqueue_upload_file_cleanup(session, document_ref, cleanup_file_ids) is not None:
            wake_knowledge_task_dispatcher_after_commit(session)
        document.indexing_status = IndexingStatus.PARSING
        document.error = None
        session.add(document)
        commit_document_phase()

        if dataset.runtime_mode == "rag_pipeline":
            assert_document_execution_owned()
            run_preparer = SQLAlchemyPipelineRunPreparer(
                session_factory=session_factory.get_session_maker(),
                generator=PipelineGenerator(
                    execution_driver=WorkflowRunAgg.run,
                    documents=SQLAlchemyDocumentRepository(session_factory=session_factory.get_session_maker()),
                    datasource_providers=build_data_source_credentials(database_client=get_session_maker()).providers,
                    attachment_writer=SQLAlchemySegmentAttachmentWriter(),
                ),
            )
            with session_factory.create_session() as rag_session:
                prepared = run_preparer.prepare_retry(
                    document,
                    user,
                    session=rag_session,
                    execution=indexing_execution,
                )
                execution_documents.commit_pipeline_indexing_phase(
                    rag_session,
                    document_ref,
                    execution=indexing_execution,
                )
            assert_document_execution_owned()
            run_preparer.execute(prepared)
        else:
            indexing_service = build_document_indexing_service(
                session_factory=session_factory.get_session_maker(), enforce_vector_space_admission=True
            )
            assert_document_execution_owned()

            indexing_service.run([document_ref], executions={document_id: indexing_execution})
            assert_document_execution_owned()
        return _document_generation_matches(
            session,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document_id,
            expected_generation=expected_generation,
        )
    except (
        DocumentIndexingExecutionClaimLostError,
        KnowledgeIndexingLeaseLostError,
        KnowledgeTaskExecutionLeaseLostError,
        DocumentIndexingGenerationChangedError,
    ):
        session.rollback()
        raise
    except Exception as error:
        session.rollback()
        execution_documents.fail_indexing(document_ref, str(error), execution=indexing_execution)
        logger.exception("retry_document_indexing_task failed, document_id: %s", document_id)
        raise


def _check_vector_space(dataset: Dataset) -> None:
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        return
    vector_space = FeatureService.get_features(dataset.tenant_id).vector_space
    assert vector_space is not None
    if 0 < vector_space.limit <= vector_space.size:
        raise ValueError(
            "Your total number of documents plus the number of uploads have over the limit of your subscription."
        )


def _document_generation_matches(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_id: str,
    expected_generation: str | None,
) -> bool:
    return bool(
        session.scalar(
            select(Document.id).where(
                Document.id == document_id,
                Document.dataset_id == dataset_id,
                Document.tenant_id == tenant_id,
                Document.indexing_generation == expected_generation,
            )
        )
    )


def _enqueue_current_document_repairs(*, dataset_id: str, document_ids: list[str], user_id: str) -> None:
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if dataset is None:
            return
        dataset_ref = DatasetRef(dataset.tenant_id, dataset.id)
    SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    ).enqueue_current_indexing_repairs(dataset_ref, document_ids, actor_id=user_id)


def _generation(document: Document) -> str | None:
    return document.indexing_generation


def _document_retry_is_terminal(document: Document) -> bool:
    return bool(
        document.indexing_status in {IndexingStatus.COMPLETED, IndexingStatus.PAUSED}
        or document.is_paused
        or not document.enabled
        or document.archived
    )
