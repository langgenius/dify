"""Celery boundaries for durable IM inbox processing and recovery.

Broker messages carry only an inbox record ID. Processing and recovery fail
before claim or backlog scan until application composition installs one
immutable record-processor factory; the separate Provider integration supplies
the concrete business consumer.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

from celery import shared_task
from flask import current_app
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.human_input_v2.im_message_inbox import IMInboxRecordId, InboxProcessingPolicy
from dify_app import DifyApp
from extensions.ext_database import db
from repositories.human_input_v2.im_message_inbox.repository import SQLAlchemyIMMessageInboxRepository
from services.human_input_v2.im_message_inbox import (
    IMInboxRecovery,
    InboxWorkerOutcome,
    OpenTelemetryIMInboxMetrics,
)
from services.human_input_v2.im_message_inbox.wakeup import InboxWakeupError

_RUNTIME_EXTENSION_KEY = "im_message_inbox_task_runtime"


class IMInboxRecordProcessor(Protocol):
    """Process one record through the repository-backed claim contract."""

    def process(self, record_id: IMInboxRecordId) -> InboxWorkerOutcome:
        """Claim and process one durable inbox record."""


class CeleryRecordTask(Protocol):
    """Narrow Celery publish surface for record-ID-only wakeups."""

    def apply_async(self, args: tuple[str, ...], *, retry: bool) -> object:
        """Publish one task without broker-side publish retries."""


@dataclass(frozen=True, slots=True)
class IMInboxTaskRuntime:
    """Application-composed factory for the concrete inbox record processor."""

    processor_factory: Callable[[], IMInboxRecordProcessor]


class IMInboxRuntimeNotConfiguredError(RuntimeError):
    """The Provider/application composition has not installed a consumer path."""


class CeleryIMInboxWakeup:
    """Bounded Celery adapter that publishes only an inbox record ID."""

    _record_task: CeleryRecordTask

    def __init__(self, record_task: CeleryRecordTask) -> None:
        self._record_task = record_task

    def publish(self, record_id: IMInboxRecordId) -> None:
        """Publish once and sanitize all broker-specific failure details."""

        try:
            self._record_task.apply_async(args=(str(record_id),), retry=False)
        except Exception as error:
            raise InboxWakeupError("failed to publish IM inbox wakeup") from error


def configure_im_inbox_task_runtime(
    app: DifyApp,
    *,
    processor_factory: Callable[[], IMInboxRecordProcessor],
) -> None:
    """Install the single application-composed processing factory."""

    app.extensions[_RUNTIME_EXTENSION_KEY] = IMInboxTaskRuntime(processor_factory=processor_factory)


def _task_runtime() -> IMInboxTaskRuntime:
    runtime = current_app.extensions.get(_RUNTIME_EXTENSION_KEY)
    if not isinstance(runtime, IMInboxTaskRuntime):
        raise IMInboxRuntimeNotConfiguredError("IM inbox record processor is not configured")
    return runtime


@shared_task(name="im_message_inbox.process_record", queue="human_input_delivery")
def process_im_message_inbox_record(record_id: str) -> str:
    """Process one record ID after application composition supplies a consumer."""

    processor = _task_runtime().processor_factory()
    return processor.process(IMInboxRecordId(record_id)).value


def _build_recovery() -> IMInboxRecovery:
    policy = InboxProcessingPolicy(
        maximum_attempts=dify_config.IM_MESSAGE_INBOX_MAXIMUM_ATTEMPTS,
        lease_duration=timedelta(seconds=dify_config.IM_MESSAGE_INBOX_LEASE_DURATION_SECONDS),
        retry_backoff_minimum=timedelta(seconds=dify_config.IM_MESSAGE_INBOX_RETRY_BACKOFF_MIN_SECONDS),
        retry_backoff_maximum=timedelta(seconds=dify_config.IM_MESSAGE_INBOX_RETRY_BACKOFF_MAX_SECONDS),
    )
    repository = SQLAlchemyIMMessageInboxRepository(
        sessionmaker(bind=db.engine, expire_on_commit=False),
        policy,
    )
    return IMInboxRecovery(
        repository=repository,
        wakeup=CeleryIMInboxWakeup(process_im_message_inbox_record),
        clock=lambda: datetime.now(UTC),
        batch_size=dify_config.IM_MESSAGE_INBOX_RECOVERY_BATCH_SIZE,
        metrics=OpenTelemetryIMInboxMetrics(),
    )


@shared_task(name="im_message_inbox.recover", queue="schedule_executor")
def recover_im_message_inbox() -> None:
    """Dispatch one bounded batch only when accepted records can be processed."""

    _task_runtime()
    _build_recovery().dispatch_available()
