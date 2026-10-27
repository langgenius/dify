"""Celery entry points of the trace pipeline, on the ``ops_trace`` queue.

Delivery is at most once per sink: an event is redelivered only while its
records are not persisted yet, or when the Agent collector could not decide
ownership (enterprise telemetry is then skipped, it already ran).
"""

import logging
import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

from celery import shared_task
from dify_trace_sdk.events import TraceEvent

from extensions.ext_application_services import application_services
from extensions.ext_storage import storage
from services.tracing.adapters import PAYLOAD_PREFIX
from services.tracing.delivery import ExportJob
from services.tracing.errors import SourceNotFoundError, SourceNotReadyError, TraceCollectorUnavailableError

logger = logging.getLogger(__name__)

REDELIVERY_LIMIT = 10
PAYLOAD_RETENTION = timedelta(days=2)
_LEGACY_PAYLOAD_PREFIX = "ops_trace/"
_PAYLOAD_DAY = re.compile(rf"{PAYLOAD_PREFIX}/(\d{{4}}-\d{{2}}-\d{{2}})/")


def _expired(key: str, cutoff: date) -> bool:
    match = _PAYLOAD_DAY.match(key)
    if match is None:
        return False
    try:
        return date.fromisoformat(match.group(1)) < cutoff
    except ValueError:
        return False


def _redelivery_delay(retries: int) -> int:
    return min(60, 5 * 2**retries)


def _delete_quietly(key: str) -> None:
    try:
        storage.delete(key)
    except Exception:
        logger.warning("Trace payload cleanup failed: key=%s", key, exc_info=True)


@shared_task(queue="ops_trace", bind=True, max_retries=REDELIVERY_LIMIT)
def deliver_trace_event(self, envelope: dict[str, Any]) -> None:
    payload_key = envelope.get("payload_key")
    redelivering = False
    try:
        raw = storage.load(payload_key) if isinstance(payload_key, str) else envelope["event"]
        event = TraceEvent.model_validate_json(raw)
    except Exception:
        logger.warning("Trace event unreadable; dropped", exc_info=True)
        if isinstance(payload_key, str):
            _delete_quietly(payload_key)
        return
    try:
        application_services().tracing.delivery.deliver(
            event, enterprise_delivered=envelope.get("enterprise_delivered") is True
        )
    except SourceNotFoundError:
        logger.info("Trace event source not found; dropped: kind=%s app_id=%s", event.payload.kind, event.app_id)
    except SourceNotReadyError:
        if self.request.retries < REDELIVERY_LIMIT:
            redelivering = True
            raise self.retry(args=(envelope,), countdown=_redelivery_delay(self.request.retries)) from None
        logger.warning("Trace event source never became ready; dropped: kind=%s", event.payload.kind)
    except TraceCollectorUnavailableError:
        if self.request.retries < REDELIVERY_LIMIT:
            redelivering = True
            raise self.retry(
                args=({**envelope, "enterprise_delivered": True},),
                countdown=_redelivery_delay(self.request.retries),
            ) from None
        logger.warning("Agent trace collector unavailable; dropped: kind=%s", event.payload.kind)
    finally:
        if isinstance(payload_key, str) and not redelivering:
            _delete_quietly(payload_key)


@shared_task(queue="ops_trace")
def retry_trace_export(job_key: str) -> None:
    try:
        job = ExportJob.model_validate_json(storage.load(job_key))
    except Exception:
        logger.warning("Trace export job unreadable; dropped: key=%s", job_key, exc_info=True)
        _delete_quietly(job_key)
        return
    try:
        application_services().tracing.delivery.retry(job)
    finally:
        _delete_quietly(job_key)


@shared_task(queue="ops_trace")
def sweep_trace_payloads() -> None:
    """Delete payloads a crashed delivery left behind, and payloads of the previous pipeline."""
    cutoff = (datetime.now(UTC) - PAYLOAD_RETENTION).date()
    # Directory listings need the trailing slash on some storage backends.
    for prefix in (f"{PAYLOAD_PREFIX}/", _LEGACY_PAYLOAD_PREFIX):
        try:
            keys = storage.scan(prefix, files=True)
        except (FileNotFoundError, NotImplementedError):
            continue
        for key in keys:
            if not key.startswith(prefix):
                continue
            if prefix == _LEGACY_PAYLOAD_PREFIX or _expired(key, cutoff):
                _delete_quietly(key)
