import logging
import time
from collections.abc import Generator, Mapping
from contextlib import ExitStack, contextmanager
from datetime import datetime

import click
from celery import shared_task
from redis.exceptions import RedisError
from sqlalchemy import select

from configs import dify_config
from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from enums import DeploymentEdition
from extensions.application_services.rag_pipeline import build_rag_pipeline_service
from extensions.ext_application_services import application_services
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models import Account, Tenant
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import IndexingStatus
from services.feature_service import FeatureService
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    document_index_lock_name,
)

logger = logging.getLogger(__name__)
_RETRY_LEASE_TIMEOUT_SECONDS = 600
_RETRY_LEASE_HANDOFF_WAIT_SECONDS = 5
_RETRY_LEASE_BUSY_RETRY_SECONDS = 60
_RETRY_LEASE_BUSY_MAX_RETRIES = 12
_RETRY_ACTIVE_STATUSES = (
    IndexingStatus.WAITING,
    IndexingStatus.PARSING,
    IndexingStatus.CLEANING,
    IndexingStatus.SPLITTING,
    IndexingStatus.INDEXING,
)


def _active_retry_generations(
    dataset_id: str,
    document_ids: list[str],
) -> dict[str, datetime | None]:
    """Snapshot the current durable retry generations for this wake-up."""

    unique_document_ids = tuple(dict.fromkeys(document_ids))
    if not unique_document_ids:
        return {}
    with session_factory.create_session() as session:
        statement = (
            select(Document.id, Document.processing_started_at)
            .join(Dataset, Dataset.id == Document.dataset_id)
            .where(
                Dataset.id == dataset_id,
                Dataset.tenant_id == Document.tenant_id,
                Document.id.in_(unique_document_ids),
                Document.indexing_status.in_(_RETRY_ACTIVE_STATUSES),
            )
        )
        generations: dict[str, datetime | None] = {}
        for document_id, started_at in session.execute(statement):
            generations[document_id] = started_at
    return {document_id: generations[document_id] for document_id in unique_document_ids if document_id in generations}


@contextmanager
def _claim_retry_leases(
    document_ids: list[str],
    user_id: str,
) -> Generator[dict[str, KnowledgeIndexingLease]]:
    """Claim server-side producer handoffs before any retry work."""

    unique_document_ids = tuple(dict.fromkeys(document_ids))

    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with ExitStack() as stack:
        claimed: dict[str, KnowledgeIndexingLease] = {}
        for document_id in unique_document_ids:
            claimed[document_id] = stack.enter_context(
                locks.hold_handoff(
                    document_index_lock_name(document_id),
                    timeout=_RETRY_LEASE_TIMEOUT_SECONDS,
                    owner_id=user_id,
                    blocking_timeout=_RETRY_LEASE_HANDOFF_WAIT_SECONDS,
                )
            )
        yield claimed


def _run_retry_document_indexing(
    dataset_id: str,
    document_ids: list[str],
    user_id: str,
    leases: Mapping[str, KnowledgeIndexingLease],
    retry_generations: Mapping[str, datetime | None],
) -> None:
    start_at = time.perf_counter()
    with session_factory.create_session() as session:
        try:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
            if not dataset:
                logger.info(click.style(f"Dataset not found: {dataset_id}", fg="red"))
                return
            user = session.scalar(select(Account).where(Account.id == user_id).limit(1))
            if not user:
                logger.info(click.style(f"User not found: {user_id}", fg="red"))
                return
            tenant = session.scalar(select(Tenant).where(Tenant.id == dataset.tenant_id).limit(1))
            if not tenant:
                raise ValueError("Tenant not found")
            user.set_current_tenant_with_session(tenant, session=session)

            for document_id in document_ids:
                lease = leases[document_id]
                lease.assert_owned()
                document_stmt = select(Document).where(
                    Document.id == document_id,
                    Document.tenant_id == dataset.tenant_id,
                    Document.dataset_id == dataset.id,
                    Document.indexing_status.in_(_RETRY_ACTIVE_STATUSES),
                    Document.processing_started_at == retry_generations[document_id],
                )
                document = session.scalar(
                    document_stmt.with_for_update(of=Document).execution_options(populate_existing=True)
                )
                if document is None:
                    session.rollback()
                    logger.warning(
                        "Skipping stale document retry generation: dataset_id=%s document_id=%s",
                        dataset_id,
                        document_id,
                    )
                    continue
                # Validate and advance this generation atomically before any
                # external cleanup or model/provider work begins.
                document.indexing_status = IndexingStatus.PARSING
                lease.assert_owned()
                session.commit()

                # check document limit
                if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
                    features = FeatureService.get_features(tenant.id)
                    try:
                        vector_space = features.vector_space
                        assert vector_space is not None
                        if 0 < vector_space.limit <= vector_space.size:
                            raise ValueError(
                                "Your total number of documents plus the number of uploads have over the limit of "
                                "your subscription."
                            )
                    except Exception as e:
                        document.indexing_status = IndexingStatus.ERROR
                        document.error = str(e)
                        document.stopped_at = naive_utc_now()
                        session.add(document)
                        lease.assert_owned()
                        session.commit()
                        continue

                logger.info(click.style(f"Start retry document: {document_id}", fg="green"))
                try:
                    # clean old data
                    index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

                    segments = session.scalars(
                        select(DocumentSegment).where(DocumentSegment.document_id == document_id)
                    ).all()
                    if segments:
                        index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
                        # delete from vector index
                        lease.assert_owned()
                        index_processor.clean(
                            dataset,
                            index_node_ids,
                            with_keywords=True,
                            delete_child_chunks=True,
                            session=session,
                        )
                        lease.assert_owned()

                    document_ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
                    session.commit()

                    runtime_mode = dataset.runtime_mode
                    lease.assert_owned()

                    if runtime_mode == "rag_pipeline":
                        with session_factory.create_session() as rag_session:
                            rag_pipeline_service = build_rag_pipeline_service(session=rag_session)
                            rag_pipeline_service.retry_error_document(
                                dataset,
                                document,
                                user,
                                generator=application_services().knowledge.pipeline_generator,
                            )
                    else:
                        indexing_service = build_document_indexing_service(
                            session_factory=session_factory.get_session_maker(), enforce_vector_space_admission=True
                        )
                        indexing_service.run([document_ref], owned_leases={document_id: lease})
                    lease.assert_owned()
                except KnowledgeIndexingLeaseLostError:
                    session.rollback()
                    raise
                except Exception as ex:
                    session.rollback()
                    document = session.scalar(
                        select(Document)
                        .where(
                            Document.id == document_id,
                            Document.tenant_id == dataset.tenant_id,
                            Document.dataset_id == dataset.id,
                        )
                        .limit(1)
                    )
                    if document:
                        document.indexing_status = IndexingStatus.ERROR
                        document.error = str(ex)
                        document.stopped_at = naive_utc_now()
                        session.add(document)
                        lease.assert_owned()
                        session.commit()
                    logger.info(click.style(str(ex), fg="yellow"))
                    logger.exception("retry_document_indexing_task failed, document_id: %s", document_id)
                lease.assert_owned()
            end_at = time.perf_counter()
            logger.info(click.style(f"Retry dataset: {dataset_id} latency: {end_at - start_at}", fg="green"))
        except Exception:
            logger.exception(
                "retry_document_indexing_task failed, dataset_id: %s, document_ids: %s", dataset_id, document_ids
            )
            raise


@shared_task(
    queue="dataset",
    autoretry_for=(KnowledgeIndexingLockBusyError, KnowledgeIndexingLeaseLostError, RedisError),
    max_retries=_RETRY_LEASE_BUSY_MAX_RETRIES,
    default_retry_delay=_RETRY_LEASE_BUSY_RETRY_SECONDS,
    acks_late=True,
    reject_on_worker_lost=True,
)
def retry_document_indexing_task(
    dataset_id: str,
    document_ids: list[str],
    user_id: str,
) -> None:
    """Wake the current durable retry generation for the requested documents.

    The established three-argument message is intentionally generation-free.
    An old queued message therefore cannot be attributed to its original HTTP
    request; it may wake a newer generation admitted by the same actor. Redis
    owner-role handoff plus the DB generation snapshot ensures it cannot steal
    an active worker or cross a recorded actor. Pre-marker messages may claim
    only after their raw lock expires and establish their existing ``user_id``
    as owner. If both Redis keys are externally lost, that legacy fallback is
    indistinguishable from a pre-marker message; DB scope and in-progress state
    still constrain the work, but original-request attribution is unavailable.
    """

    preflight_generations = _active_retry_generations(dataset_id, document_ids)
    if not preflight_generations:
        return
    active_document_ids = list(preflight_generations)
    with _claim_retry_leases(active_document_ids, user_id) as leases:
        # Resolve the generation only after claiming the server-side producer
        # handoff. A queued message is a wake-up for the current same-actor
        # generation, not a capability for the HTTP request that created it.
        retry_generations = _active_retry_generations(dataset_id, active_document_ids)
        if not retry_generations:
            return
        current_document_ids = list(retry_generations)
        _run_retry_document_indexing(
            dataset_id,
            current_document_ids,
            user_id,
            {document_id: leases[document_id] for document_id in current_document_ids},
            retry_generations,
        )
