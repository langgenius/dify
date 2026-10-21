"""Compatibility consumer for pre-outbox dataset index update deliveries."""

import logging
from functools import partial

from celery import shared_task

from core.db.session_factory import session_factory
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.api_token_service import ApiTokenCache
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit

logger = logging.getLogger(__name__)


@shared_task(
    queue="dataset",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def deal_dataset_index_update_task(dataset_id: str, action: str) -> None:
    """Convert a deployed legacy update/upgrade payload into current durable work."""

    datasets = SQLAlchemyDatasetRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
    )
    converted = datasets.convert_legacy_vector_index_delivery(dataset_id)
    logger.info(
        "Legacy dataset index update reconciled dataset_id=%s legacy_action=%s converted=%s",
        dataset_id,
        action,
        converted,
    )
