"""Celery entrypoints dedicated to tenant-configured Human Input v2 delivery."""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.delivery_runtime import (
    EmailProviderAdapterRegistry,
    HumanInputRenderedEmailDeliveryRuntime,
)
from core.human_input_v2.shared import DeliveryAttemptId
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from repositories.human_input_v2.email_channel import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.form import SQLAlchemyDeliveryAttemptRepository
from services.human_input_v2.delivery_publisher import HumanInputV2DueAttemptPublisher
from services.human_input_v2.delivery_runtime import (
    DifyEmailCredentialProtector,
    TenantEmailConfigurationSnapshotResolver,
)
from services.human_input_v2.delivery_worker import HumanInputV2DeliveryWorker
from services.human_input_v2.notification_producer import DifyRenderedEmailRequestProtector
from services.human_input_v2.resend_delivery import HttpxResendTransport, ResendEmailProviderAdapter

logger = logging.getLogger(__name__)


def _operation_sessions(session_factory: sessionmaker[Session] | None = None) -> sessionmaker[Session]:
    return session_factory or sessionmaker(bind=db.engine, expire_on_commit=False)


def build_human_input_v2_delivery_worker(
    session_factory: sessionmaker[Session] | None = None,
) -> HumanInputV2DeliveryWorker:
    sessions = _operation_sessions(session_factory)
    attempt_repository = SQLAlchemyDeliveryAttemptRepository(sessions)
    resolver = TenantEmailConfigurationSnapshotResolver(
        SQLAlchemyEmailChannelRepository(sessions),
        DifyEmailCredentialProtector(),
    )
    adapter = ResendEmailProviderAdapter(HttpxResendTransport())
    runtime = HumanInputRenderedEmailDeliveryRuntime(
        resolver,
        EmailProviderAdapterRegistry((adapter,)),
    )
    return HumanInputV2DeliveryWorker(
        attempt_repository,
        DifyRenderedEmailRequestProtector(),
        runtime,
    )


@shared_task(queue="human_input_delivery")
def dispatch_human_input_v2_delivery_attempt_task(attempt_id: str) -> None:
    """Accept only a durable attempt identity across the Celery boundary."""

    try:
        build_human_input_v2_delivery_worker().deliver(DeliveryAttemptId(attempt_id))
    except Exception:
        logger.exception("Human Input v2 delivery worker failed, attempt_id=%s", attempt_id)
        raise


@shared_task(queue="human_input_delivery")
def publish_due_human_input_v2_delivery_attempts_task() -> None:
    sessions = _operation_sessions()
    repository = SQLAlchemyDeliveryAttemptRepository(sessions)
    now = naive_utc_now()
    repository.recover_stale(
        stale_before=now - timedelta(minutes=5),
        idempotency_cutoff=now - timedelta(hours=23),
        now=now,
        limit=100,
    )

    def enqueue(attempt_id: DeliveryAttemptId) -> None:
        dispatch_human_input_v2_delivery_attempt_task.apply_async(
            args=(str(attempt_id),),
            queue="human_input_delivery",
        )

    publisher = HumanInputV2DueAttemptPublisher(
        repository,
        enqueue,
    )
    publisher.publish_due()


__all__ = [
    "build_human_input_v2_delivery_worker",
    "dispatch_human_input_v2_delivery_attempt_task",
    "publish_due_human_input_v2_delivery_attempts_task",
]
