"""Celery execution boundary for durable IM callbacks."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from celery import shared_task
from flask import current_app

from core.human_input_v2.im_message_inbox import IMInboxRecordId
from dify_app import DifyApp

logger = logging.getLogger(__name__)

_RUNTIME_EXTENSION_KEY = "im_message_inbox_task_runtime"
_MAX_RETRIES = 5


class IMInboxRecordProcessor(Protocol):
    """Process one callback record without owning task retry policy."""

    def process(self, record_id: IMInboxRecordId) -> None:
        """Process one durable callback record."""


@dataclass(frozen=True, slots=True)
class IMInboxTaskRuntime:
    """Application-composed factory for callback processing."""

    processor_factory: Callable[[], IMInboxRecordProcessor]


class IMInboxRuntimeNotConfiguredError(Exception):
    """Application composition has not installed callback processing."""


class IMInboxTaskRetryError(Exception):
    """Sanitized callback processing failure retried by Celery."""


def configure_im_inbox_task_runtime(
    app: DifyApp,
    *,
    processor_factory: Callable[[], IMInboxRecordProcessor],
) -> None:
    """Install the application-composed callback processor factory."""

    app.extensions[_RUNTIME_EXTENSION_KEY] = IMInboxTaskRuntime(processor_factory=processor_factory)


def _task_runtime() -> IMInboxTaskRuntime:
    runtime = current_app.extensions.get(_RUNTIME_EXTENSION_KEY)
    if not isinstance(runtime, IMInboxTaskRuntime):
        raise IMInboxRuntimeNotConfiguredError("IM callback processor is not configured")
    return runtime


@shared_task(
    name="im_message_inbox.process_record",
    queue="human_input_delivery",
    autoretry_for=(IMInboxTaskRetryError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": _MAX_RETRIES},
    acks_late=True,
    reject_on_worker_lost=True,
)
def process_im_message_inbox_record(record_id: str) -> None:
    """Process one committed callback and let Celery own retry lifecycle."""

    runtime = _task_runtime()
    try:
        processor = runtime.processor_factory()
        processor.process(IMInboxRecordId(record_id))
    except Exception:
        logger.warning("IM callback processing will be retried record_id=%s", record_id)
        raise IMInboxTaskRetryError(f"failed to process IM callback record {record_id}") from None
