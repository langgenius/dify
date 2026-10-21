"""Durable external-index cleanup independent from relational deletion."""

from collections.abc import Mapping

from celery import shared_task
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.task_outbox_repository import enqueue_knowledge_task
from services.knowledge.indexing.adapters.cleanup import clean_deletion_index
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.cleanup import DeletionIndexCleanup
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError, dataset_index_lock_name
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError, KnowledgeTaskKind
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from tasks.knowledge_task_outbox_task import knowledge_task_execution
from tasks.refresh_billing_vector_space_task import schedule_billing_vector_space_refresh

_LEASE_TIMEOUT_SECONDS = 600


def _indexing_lock() -> RedisKnowledgeIndexingLock:
    return RedisKnowledgeIndexingLock(redis=redis_client)


def _dataset_repository() -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        revoke_keys_after_commit=lambda _session, _token_ids: None,
    )


def enqueue_deletion_index_cleanup(
    session: Session,
    *,
    cleanup: DeletionIndexCleanup,
    source_outbox_id: str | None,
) -> str | None:
    """Persist one external-index intent before relational cleanup starts."""

    if not cleanup.delete_all and not cleanup.vector_node_ids and not cleanup.keyword_node_ids:
        return None
    if source_outbox_id is not None:
        already_enqueued = session.scalar(
            select(
                exists().where(
                    KnowledgeTaskOutbox.task_kind == KnowledgeTaskKind.DELETION_INDEX_CLEANUP,
                    KnowledgeTaskOutbox.resource_id == source_outbox_id,
                )
            )
        )
        if already_enqueued:
            return None
    intent_id = enqueue_knowledge_task(
        session,
        kind=KnowledgeTaskKind.DELETION_INDEX_CLEANUP,
        tenant_id=cleanup.tenant_id,
        dataset_id=cleanup.dataset_id,
        resource_id=source_outbox_id,
        payload=cleanup.to_payload(),
    )
    wake_knowledge_task_dispatcher_after_commit(session)
    return intent_id


@shared_task(
    queue="dataset",
    autoretry_for=(Exception,),
    dont_autoretry_for=(KnowledgeTaskDeliveryHandledError,),
    retry_backoff=True,
    max_retries=5,
    acks_late=True,
    reject_on_worker_lost=True,
)
def cleanup_knowledge_index_task(payload: Mapping[str, object], outbox_id: str | None = None) -> None:
    """Retry external index cleanup without retaining deleted SQL resources."""

    with knowledge_task_execution(outbox_id) as execution:
        if execution is None:
            return
        cleanup = DeletionIndexCleanup.from_payload(payload)
        try:
            with _indexing_lock().hold(
                dataset_index_lock_name(cleanup.dataset_id),
                timeout=_LEASE_TIMEOUT_SECONDS,
                blocking_timeout=_LEASE_TIMEOUT_SECONDS,
            ) as dataset_lease:

                def assert_cleanup_owned() -> None:
                    execution.assert_owned()
                    dataset_lease.assert_owned()

                assert_cleanup_owned()
                clean_deletion_index(
                    cleanup,
                    new_session=session_factory.create_session,
                    assert_owned=assert_cleanup_owned,
                )
                assert_cleanup_owned()
        except KnowledgeIndexingLeaseLostError:
            _dataset_repository().enqueue_current_vector_repair(DatasetRef(cleanup.tenant_id, cleanup.dataset_id))
            raise
        execution.assert_owned()
        if cleanup.refresh_billing and cleanup.indexing_technique == "high_quality":
            schedule_billing_vector_space_refresh(cleanup.tenant_id)
