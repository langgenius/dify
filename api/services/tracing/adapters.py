"""Runtime adapters of the trace pipeline over Celery, storage, workspace keys, and enterprise telemetry.

Events are handed to a bounded background publisher; large ones travel through
storage instead of the broker. Dated payload keys let the sweeper expire files
that a crashed delivery left behind.
"""

import atexit
import logging
import os
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import BoundedSemaphore
from typing import override
from uuid import uuid4

from celery import current_app as celery_app
from celery.signals import worker_process_shutdown
from dify_trace_sdk.emitter import TraceEmitter, TraceScope
from dify_trace_sdk.events import TraceCorrelation, TraceEvent

from core.helper.encrypter import batch_decrypt_token, encrypt_token, obfuscated_token
from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace
from extensions.ext_storage import storage
from extensions.tracing import ExecutionTraceScopes
from repositories.app.tracing_config_repository import trace_settings_from_column
from services.tracing.delivery import ExportJob, ExportRetryQueue
from services.tracing.providers import TracingSecretCipher
from services.tracing.records import BaseTraceInfo
from services.tracing.scopes import TraceScopes

DELIVER_TASK = "tasks.trace_delivery_task.deliver_trace_event"
RETRY_TASK = "tasks.trace_delivery_task.retry_trace_export"
AGENT_TRACE_EXPORT_TASK = "tasks.application_trace_task.export_application_trace"
PAYLOAD_PREFIX = "trace_payloads"
INLINE_EVENT_BYTES = 256 * 1024
PENDING_EVENT_LIMIT = 256
# Node executions may be saved by another worker after their run row; give them time to land.
WORKFLOW_SETTLE_SECONDS = 5

logger = logging.getLogger(__name__)


def payload_key(day: datetime, kind: str, identifier: str) -> str:
    """Storage key for a trace payload; the date prefix lets the sweeper expire it."""
    return f"{PAYLOAD_PREFIX}/{day:%Y-%m-%d}/{kind}/{identifier}.json"


class CeleryTraceEmitter(TraceEmitter):
    """Best-effort publication without storage or broker I/O on producer threads.

    A full buffer drops the new event with a warning. Normal shutdown drains
    accepted events; a process crash can lose events not yet published.
    """

    def __init__(self) -> None:
        self._closed = False
        self._reset_publisher()
        os.register_at_fork(after_in_child=self._after_fork)
        atexit.register(self.shutdown)
        worker_process_shutdown.connect(self.shutdown, dispatch_uid=f"trace-publisher-{id(self)}")

    def _reset_publisher(self) -> None:
        self._slots = BoundedSemaphore(PENDING_EVENT_LIMIT)
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="trace-publisher")

    def _after_fork(self) -> None:
        # Parent threads and pending events belong to the parent process.
        if not self._closed:
            self._reset_publisher()

    @override
    def emit(self, event: TraceEvent) -> None:
        if not self._slots.acquire(blocking=False):
            logger.warning(
                "Trace publisher buffer full; event dropped: event_id=%s app_id=%s", event.event_id, event.app_id
            )
            return
        try:
            # Snapshot mutable payload fields and the caller's Celery app before handoff.
            encoded = event.model_dump_json()
            self._executor.submit(self._publish, event, encoded, celery_app.send_task)
        except Exception:
            self._slots.release()
            raise

    def _publish(self, event: TraceEvent, encoded: str, send_task: Callable[..., object]) -> None:
        try:
            data = encoded.encode()
            if len(data) > INLINE_EVENT_BYTES:
                key = payload_key(event.occurred_at, "events", event.event_id)
                storage.save(key, data)
                envelope = {"payload_key": key}
            else:
                envelope = {"event": encoded}
            countdown = WORKFLOW_SETTLE_SECONDS if event.payload.kind == "workflow_run" else 0
            send_task(DELIVER_TASK, args=(envelope,), countdown=countdown)
        except Exception as error:
            logger.warning(
                "Trace publication failed: event_id=%s app_id=%s error_type=%s",
                event.event_id,
                event.app_id,
                type(error).__name__,
            )
        finally:
            self._slots.release()

    def shutdown(self, **_: object) -> None:
        """Drain accepted events at interpreter or Celery child-process shutdown."""
        self._closed = True
        self._executor.shutdown(wait=True)


class StoredPolicyTraceScopes(ExecutionTraceScopes):
    """Read the raw stored policy that legacy producers hold, as the policy repository reads it."""

    def __init__(self, scopes: TraceScopes) -> None:
        self._scopes = scopes

    @override
    def for_execution(
        self,
        *,
        tenant_id: str,
        app_id: str | None,
        app_tracing: str | None,
        user_id: str | None,
        correlation: TraceCorrelation,
    ) -> TraceScope | None:
        return self._scopes.for_execution(
            tenant_id=tenant_id,
            app_id=app_id,
            policy=trace_settings_from_column(app_tracing),
            user_id=user_id,
            correlation=correlation,
        )

    @override
    def for_app(
        self, *, tenant_id: str, app_id: str | None, user_id: str | None, correlation: TraceCorrelation
    ) -> TraceScope | None:
        return self._scopes.for_app(tenant_id=tenant_id, app_id=app_id, user_id=user_id, correlation=correlation)


class CeleryExportRetryQueue(ExportRetryQueue):
    @override
    def schedule(self, job: ExportJob, *, delay_seconds: int) -> None:
        key = payload_key(datetime.now(UTC), "exports", uuid4().hex)
        storage.save(key, job.model_dump_json().encode())
        celery_app.send_task(RETRY_TASK, args=(key,), countdown=delay_seconds)


class WorkspaceTracingSecretCipher(TracingSecretCipher):
    @override
    def encrypt(self, tenant_id: str, value: str) -> str:
        return encrypt_token(tenant_id, value)

    @override
    def decrypt(self, tenant_id: str, tokens: Sequence[str]) -> list[str]:
        return batch_decrypt_token(tenant_id, list(tokens))

    @override
    def mask(self, value: str) -> str:
        return obfuscated_token(value)


def schedule_agent_trace_export(run_id: str) -> None:
    celery_app.send_task(AGENT_TRACE_EXPORT_TASK, args=(run_id,))


def send_to_enterprise_telemetry(record: BaseTraceInfo) -> None:
    EnterpriseOtelTrace().trace(record)
