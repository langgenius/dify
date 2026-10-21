"""Periodic and on-demand dispatcher for durable knowledge task intents."""

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import timedelta

from celery import shared_task

from configs import dify_config
from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from repositories.knowledge.task_outbox_repository import SQLAlchemyKnowledgeTaskStore
from services.knowledge.task_outbox.adapters import CeleryKnowledgeTaskPublisher
from services.knowledge.task_outbox.application import KnowledgeTaskOutboxDispatcher
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease
from services.knowledge.task_outbox.execution import knowledge_task_execution as execute_knowledge_task
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher
from services.knowledge.task_outbox.tenant_queue import KNOWLEDGE_TASK_V2_QUEUE, recover_knowledge_tenant_tasks

logger = logging.getLogger(__name__)


def defer_knowledge_task_before_execution(outbox_id: str, *, error: str, delay: int) -> bool:
    """Keep a blocked delivery pending without spending its execution budget."""

    if delay <= 0:
        raise ValueError("Knowledge task deferral delay must be positive")
    return SQLAlchemyKnowledgeTaskStore(session_factory=session_factory.create_session).defer_task_delivery(
        intent_id=outbox_id,
        available_at=naive_utc_now() + timedelta(seconds=delay),
        error=error,
    )


def knowledge_task_execution(
    outbox_id: str | None, *, assert_admitted: Callable[[], None] | None = None
) -> AbstractContextManager[KnowledgeTaskExecutionLease | None]:
    """Compose execution bookkeeping at the Celery adapter boundary."""

    return execute_knowledge_task(
        outbox_id,
        store=SQLAlchemyKnowledgeTaskStore(session_factory=session_factory.create_session),
        wake=wake_knowledge_task_dispatcher,
        assert_admitted=assert_admitted,
    )


@shared_task(queue=KNOWLEDGE_TASK_V2_QUEUE)
def dispatch_knowledge_task_outbox() -> None:
    dispatcher = KnowledgeTaskOutboxDispatcher(
        store=SQLAlchemyKnowledgeTaskStore(session_factory=session_factory.create_session),
        publisher=CeleryKnowledgeTaskPublisher(),
    )
    result = dispatcher.dispatch_pending(limit=dify_config.KNOWLEDGE_TASK_OUTBOX_BATCH_SIZE)
    if result.claimed:
        logger.info(
            "Knowledge task outbox dispatched=%d deferred=%d claimed=%d",
            result.dispatched,
            result.deferred,
            result.claimed,
        )


@shared_task(queue=KNOWLEDGE_TASK_V2_QUEUE)
def recover_knowledge_tenant_task_queue() -> None:
    """Recover accepted tenant deliveries even when periodic outbox publishing is disabled."""
    recover_knowledge_tenant_tasks()
