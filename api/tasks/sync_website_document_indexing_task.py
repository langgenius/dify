import logging
import time
from collections.abc import Generator
from contextlib import contextmanager
from uuid import uuid4

import click
from celery import shared_task
from redis.exceptions import RedisError
from sqlalchemy import delete, select

from configs import dify_config
from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor import IndexProcessorFactory
from enums import DeploymentEdition
from extensions.application_services.data_sources import build_website_service
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, DocumentSegment
from models.enums import DataSourceType, IndexingStatus
from repositories.knowledge.document_repository import _get_document, _lock_document
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
_SYNC_LEASE_TIMEOUT_SECONDS = 600
_SYNC_WORKER_TOKEN_PREFIX = "website-worker:"
_SYNC_LEASE_RETRY_SECONDS = 60
_SYNC_LEASE_MAX_RETRIES = 12
_SYNC_ACTIVE_STATUSES = (
    IndexingStatus.WAITING,
    IndexingStatus.PARSING,
    IndexingStatus.CLEANING,
    IndexingStatus.SPLITTING,
    IndexingStatus.INDEXING,
)


def _validate_website_source_identity(*, tenant_id: str, source_info: dict[str, object]) -> None:
    website = build_website_service(database_client=session_factory.get_session_maker())
    website.validate_stored_source(tenant_id=tenant_id, source_info=source_info)


def _sync_marker_name(document_id: str) -> str:
    return f"document_{document_id}_is_sync"


def _marker_token(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if isinstance(value, str):
        return value
    raise TypeError("Website sync marker token must be text")


@contextmanager
def _hold_website_sync_lease(
    document_id: str,
) -> Generator[KnowledgeIndexingLease]:
    """Wake the current sync using the established two-argument message.

    Observe and adopt the admission marker while holding the worker mutex.
    The compare-token adoption rejects a marker replaced after this read.
    """

    marker_name = _sync_marker_name(document_id)
    worker_locks = RedisKnowledgeIndexingLock(redis=redis_client)
    main_locks = RedisKnowledgeIndexingLock(
        redis=redis_client,
        token_factory=lambda: f"{_SYNC_WORKER_TOKEN_PREFIX}{uuid4().hex}",
    )
    # Only this independent worker owner may observe and adopt the main marker.
    # A duplicate delivery therefore cannot mistake the rotated worker token for
    # a producer token and steal an active lease.
    with worker_locks.hold(
        f"{marker_name}:worker",
        timeout=_SYNC_LEASE_TIMEOUT_SECONDS,
        blocking_timeout=0,
    ):
        current_token = _marker_token(redis_client.get(marker_name))
        if current_token is not None and current_token.startswith(_SYNC_WORKER_TOKEN_PREFIX):
            raise KnowledgeIndexingLockBusyError(f"Website sync worker already owns {marker_name}")
        with main_locks.hold(
            marker_name,
            timeout=_SYNC_LEASE_TIMEOUT_SECONDS,
            expected_token=current_token,
            blocking_timeout=0,
        ) as lease:
            yield lease


@contextmanager
def _hold_document_indexing_lease(document_id: str) -> Generator[KnowledgeIndexingLease]:
    locks = RedisKnowledgeIndexingLock(redis=redis_client)
    with locks.hold(
        document_index_lock_name(document_id),
        timeout=_SYNC_LEASE_TIMEOUT_SECONDS,
        blocking_timeout=5,
    ) as lease:
        yield lease


@shared_task(
    queue="dataset",
    autoretry_for=(KnowledgeIndexingLockBusyError, KnowledgeIndexingLeaseLostError, RedisError),
    max_retries=_SYNC_LEASE_MAX_RETRIES,
    default_retry_delay=_SYNC_LEASE_RETRY_SECONDS,
    acks_late=True,
    reject_on_worker_lost=True,
)
def sync_website_document_indexing_task(
    dataset_id: str,
    document_id: str,
):
    """
    Async process document
    :param dataset_id:
    :param document_id:

    Usage: sync_website_document_indexing_task.delay(dataset_id, document_id)
    """
    start_at = time.perf_counter()

    # Every production sync request persists WAITING before dispatch. A late-ack
    # redelivery may observe any later in-progress phase of that same sync.
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if dataset is None:
            raise ValueError("Dataset not found")
        dataset_ref = DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id)
        document_ref = dataset_ref.document(document_id)
        document = _get_document(session, document_ref)
        if document is None:
            logger.info(click.style(f"Document not found: {document_id}", fg="yellow"))
            return
        if document.data_source_type != DataSourceType.WEBSITE_CRAWL:
            raise ValueError("Document is not a website document")
        if document.indexing_status not in _SYNC_ACTIVE_STATUSES:
            logger.info(
                "Website sync is no longer active, skipping stale task: document_id=%s status=%s",
                document_id,
                document.indexing_status,
            )
            return

    with _hold_website_sync_lease(document_id) as sync_lease:
        with _hold_document_indexing_lease(document_id) as indexing_lease:
            _run_website_document_sync(
                dataset_id=dataset_id,
                document_id=document_id,
                sync_lease=sync_lease,
                indexing_lease=indexing_lease,
                start_at=start_at,
            )


def _run_website_document_sync(
    *,
    dataset_id: str,
    document_id: str,
    sync_lease: KnowledgeIndexingLease,
    indexing_lease: KnowledgeIndexingLease,
    start_at: float,
) -> None:
    with session_factory.create_session() as session:
        dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))
        if dataset is None:
            raise ValueError("Dataset not found")
        tenant_id = dataset.tenant_id
        dataset_ref = DatasetRef(tenant_id=tenant_id, dataset_id=dataset.id)
        document_ref = dataset_ref.document(document_id)
        document = _get_document(session, document_ref)
        if document is None:
            logger.info(click.style(f"Document not found: {document_id}", fg="yellow"))
            return
        if document.data_source_type != "website_crawl":
            raise ValueError("Document is not a website document")
        if document.indexing_status not in _SYNC_ACTIVE_STATUSES:
            logger.info(
                "Website sync became terminal before lease claim, skipping stale task: document_id=%s status=%s",
                document_id,
                document.indexing_status,
            )
            return
        sync_lease.assert_owned()
        indexing_lease.assert_owned()
        resume_status = document.indexing_status

        # INDEXING resumes already-persisted chunks and no longer needs the
        # external website source. Earlier phases still need executable source
        # identity before they can safely restart extraction.
        if resume_status != IndexingStatus.INDEXING:
            try:
                _validate_website_source_identity(
                    tenant_id=tenant_id,
                    source_info=document.data_source_info_dict,
                )
            except Exception as error:
                session.rollback()
                locked_document = _lock_document(session, document_ref)
                sync_lease.assert_owned()
                indexing_lease.assert_owned()
                if locked_document is not None and locked_document.indexing_status in _SYNC_ACTIVE_STATUSES:
                    # Only a not-yet-started sync can retain its previously
                    # published index. Later phases may already have removed it.
                    if (
                        locked_document.indexing_status == IndexingStatus.WAITING
                        and locked_document.completed_at is not None
                    ):
                        locked_document.indexing_status = IndexingStatus.COMPLETED
                        locked_document.error = None
                    else:
                        locked_document.indexing_status = IndexingStatus.ERROR
                        locked_document.error = f"Website source is not executable: {error}"
                        locked_document.stopped_at = naive_utc_now()
                    session.add(locked_document)
                    sync_lease.assert_owned()
                    indexing_lease.assert_owned()
                    session.commit()
                logger.warning(
                    "Website sync source identity is not executable: document_id=%s", document_id, exc_info=True
                )
                return

        # check document limit
        if resume_status != IndexingStatus.INDEXING and dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            features = FeatureService.get_features(dataset.tenant_id)
            try:
                vector_space = features.vector_space
                assert vector_space is not None
                if 0 < vector_space.limit <= vector_space.size:
                    raise ValueError(
                        "Your total number of documents plus the number of uploads have over the limit of "
                        "your subscription."
                    )
            except Exception as e:
                session.rollback()
                locked_document = _lock_document(session, document_ref)
                sync_lease.assert_owned()
                indexing_lease.assert_owned()
                if locked_document is None or locked_document.indexing_status not in _SYNC_ACTIVE_STATUSES:
                    return
                locked_document.indexing_status = IndexingStatus.ERROR
                locked_document.error = str(e)
                locked_document.stopped_at = naive_utc_now()
                session.add(locked_document)
                sync_lease.assert_owned()
                indexing_lease.assert_owned()
                session.commit()
                return

        logger.info(click.style(f"Start sync website document: {document_id}", fg="green"))
        try:
            sync_lease.assert_owned()
            indexing_lease.assert_owned()
            indexing_service = build_document_indexing_service(session_factory=session_factory.get_session_maker())
            if resume_status == IndexingStatus.INDEXING:
                indexing_service.run_in_indexing_status(document_ref, owned_lease=indexing_lease)
                sync_lease.assert_owned()
                return
            if resume_status == IndexingStatus.SPLITTING:
                indexing_service.run_in_splitting_status(document_ref, owned_lease=indexing_lease)
                sync_lease.assert_owned()
                return

            # clean old data
            index_processor = IndexProcessorFactory(document.doc_form).init_index_processor()

            segments = session.scalars(
                select(DocumentSegment).where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == document_id,
                )
            ).all()
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments if segment.index_node_id]
                # delete from vector index
                if index_node_ids:
                    sync_lease.assert_owned()
                    indexing_lease.assert_owned()
                    index_processor.clean(
                        dataset, index_node_ids, with_keywords=True, delete_child_chunks=True, session=session
                    )
                    sync_lease.assert_owned()
                    indexing_lease.assert_owned()

            segment_ids = [segment.id for segment in segments]
            if segment_ids:
                segment_delete_stmt = delete(DocumentSegment).where(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == document_id,
                )
                session.execute(segment_delete_stmt)
            sync_lease.assert_owned()
            indexing_lease.assert_owned()
            session.commit()

            active_document = _lock_document(session, document_ref)
            sync_lease.assert_owned()
            indexing_lease.assert_owned()
            if active_document is None or active_document.indexing_status not in _SYNC_ACTIVE_STATUSES:
                return
            active_document.indexing_status = IndexingStatus.PARSING
            active_document.processing_started_at = naive_utc_now()
            session.add(active_document)
            # Release document/segment locks before extraction starts.
            sync_lease.assert_owned()
            indexing_lease.assert_owned()
            session.commit()
            indexing_service.run([document_ref], owned_leases={document_id: indexing_lease})
            sync_lease.assert_owned()
        except KnowledgeIndexingLeaseLostError:
            session.rollback()
            raise
        except Exception as ex:
            session.rollback()
            # A replacement owner may already be processing a newer WAITING
            # generation. Never use this worker's stale ORM state after loss.
            locked_document = _lock_document(session, document_ref)
            sync_lease.assert_owned()
            indexing_lease.assert_owned()
            if locked_document and locked_document.indexing_status in _SYNC_ACTIVE_STATUSES:
                locked_document.indexing_status = IndexingStatus.ERROR
                locked_document.error = str(ex)
                locked_document.stopped_at = naive_utc_now()
                session.add(locked_document)
                sync_lease.assert_owned()
                indexing_lease.assert_owned()
                session.commit()
            logger.info(click.style(str(ex), fg="yellow"))
            logger.exception("sync_website_document_indexing_task failed, document_id: %s", document_id)
        end_at = time.perf_counter()
        logger.info(click.style(f"Sync document: {document_id} latency: {end_at - start_at}", fg="green"))
