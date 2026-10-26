"""Bounded application-span delivery to the API-owned, durable tracing inbox.

The Agent backend never holds third-party credentials. A successful export means
the inner API acknowledged this exact batch. Exhausted retries are retained until
run finalization; a run with dropped or unacknowledged spans never sends ``final``.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import defaultdict, deque
from collections.abc import Sequence
from typing import Final, override
from uuid import UUID, uuid5

import httpx
from opentelemetry.context import Context
from opentelemetry.sdk.trace import ReadableSpan, Span, SpanProcessor
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.trace import StatusCode
from pydantic import JsonValue, TypeAdapter

from dify_agent.protocol.tracing import AgentTraceBatch, AgentTraceBatchAcknowledgement, AgentTraceEvent, AgentTraceSpan

DIFY_TRACING_RUN_ID_ATTRIBUTE: Final[str] = "dify.tracing.run_id"
DIFY_TRACING_INVOCATION_ID_ATTRIBUTE: Final[str] = "dify.tracing.invocation_id"
_JSON_ATTRIBUTES = TypeAdapter(dict[str, JsonValue])
logger = logging.getLogger(__name__)


def _scope(span: ReadableSpan) -> tuple[UUID, UUID] | None:
    attributes = span.attributes or {}
    try:
        return (
            UUID(str(attributes[DIFY_TRACING_RUN_ID_ATTRIBUTE])),
            UUID(str(attributes[DIFY_TRACING_INVOCATION_ID_ATTRIBUTE])),
        )
    except (KeyError, ValueError):
        return None


def _serialize_span(span: ReadableSpan) -> AgentTraceSpan:
    context = span.get_span_context()
    if context is None or span.start_time is None or span.end_time is None:
        raise ValueError("Application tracing requires a completed span")
    return AgentTraceSpan(
        trace_id=f"{context.trace_id:032x}",
        span_id=f"{context.span_id:016x}",
        parent_span_id=f"{span.parent.span_id:016x}" if span.parent else None,
        name=span.name,
        start_time_ns=span.start_time,
        end_time_ns=span.end_time,
        attributes=_JSON_ATTRIBUTES.validate_json(json.dumps(dict(span.attributes or {}), allow_nan=False)),
        status="error" if span.status.status_code == StatusCode.ERROR else "ok",
        status_message=span.status.description,
        events=[
            AgentTraceEvent(
                name=event.name,
                timestamp_ns=event.timestamp,
                attributes=_JSON_ATTRIBUTES.validate_json(json.dumps(dict(event.attributes or {}), allow_nan=False)),
            )
            for event in span.events
        ],
    )


class JSONSpanExporter(SpanExporter):
    """Send idempotent JSON batches using the server-owned inner API credential."""

    def __init__(
        self,
        *,
        inner_api_url: str,
        inner_api_key: str,
        client: httpx.Client | None = None,
        max_attempts: int = 3,
        retry_delay_seconds: float = 0.1,
        max_pending_batches: int = 128,
        max_batch_bytes: int = 1024 * 1024,
    ) -> None:
        self._url = f"{inner_api_url.rstrip('/')}/inner/api/agent/tracing/batches"
        self._headers = {"X-Inner-Api-Key": inner_api_key}
        self._client = client or httpx.Client(timeout=2.0, trust_env=False)
        self._owns_client = client is None
        self._max_attempts = max(1, max_attempts)
        self._retry_delay_seconds = retry_delay_seconds
        self._max_pending_batches = max_pending_batches
        self._max_batch_bytes = max_batch_bytes
        self._pending: dict[UUID, AgentTraceBatch] = {}
        self._incomplete_runs: set[tuple[UUID, UUID]] = set()
        self._state_lock = threading.Lock()
        self._delivery_lock = threading.RLock()

    def mark_incomplete(self, scope: tuple[UUID, UUID]) -> None:
        with self._state_lock:
            self._incomplete_runs.add(scope)

    @override
    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        grouped: dict[tuple[UUID, UUID], list[AgentTraceSpan]] = defaultdict(list)
        successful = True
        for span in spans:
            scope = _scope(span)
            if scope is None:
                successful = False
                continue
            try:
                grouped[scope].append(_serialize_span(span))
            except Exception:
                self.mark_incomplete(scope)
                successful = False
                logger.warning("Invalid application trace span; run_id=%s invocation_id=%s", *scope)
        with self._delivery_lock:
            for (run_id, invocation_id), run_spans in grouped.items():
                batches, oversized = self._batches(run_id, invocation_id, run_spans)
                successful = successful and not oversized
                for batch in batches:
                    if not self._deliver(batch):
                        successful = False
                        if len(self._pending) < self._max_pending_batches:
                            self._pending[batch.batch_id] = batch
                        else:
                            self.mark_incomplete((run_id, invocation_id))
        return SpanExportResult.SUCCESS if successful else SpanExportResult.FAILURE

    def _batches(
        self, run_id: UUID, invocation_id: UUID, spans: list[AgentTraceSpan]
    ) -> tuple[list[AgentTraceBatch], bool]:
        batches: list[AgentTraceBatch] = []
        current: list[AgentTraceSpan] = []
        # Reserve more than the fixed envelope, commas and list punctuation.
        size = 1024
        oversized = False

        def append_batch() -> None:
            encoded = json.dumps(
                [span.model_dump(mode="json") for span in current],
                sort_keys=True,
                ensure_ascii=False,
                separators=(",", ":"),
            )
            batches.append(
                AgentTraceBatch(
                    run_id=run_id,
                    invocation_id=invocation_id,
                    batch_id=uuid5(invocation_id, hashlib.sha256(encoded.encode()).hexdigest()),
                    spans=list(current),
                )
            )

        for span in spans:
            span_size = len(span.model_dump_json().encode()) + 1
            if span_size + 1024 > self._max_batch_bytes:
                oversized = True
                self.mark_incomplete((run_id, invocation_id))
                logger.warning("Application trace span exceeds delivery limit; invocation_id=%s", invocation_id)
                continue
            if size + span_size > self._max_batch_bytes:
                append_batch()
                current = []
                size = 1024
            current.append(span)
            size += span_size
        if current:
            append_batch()
        return batches, oversized

    def _deliver(self, batch: AgentTraceBatch) -> bool:
        payload = batch.model_dump(mode="json")
        if len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()) > self._max_batch_bytes:
            self.mark_incomplete((batch.run_id, batch.invocation_id))
            return False
        for attempt in range(self._max_attempts):
            retryable = True
            try:
                response = self._client.post(self._url, headers=self._headers, json=payload)
                if response.is_success:
                    acknowledgement = AgentTraceBatchAcknowledgement.model_validate(response.json())
                    if acknowledgement.batch_id == batch.batch_id and acknowledgement.accepted_spans == len(
                        batch.spans
                    ):
                        return True
                retryable = response.status_code >= 500 or response.status_code in (408, 429)
            except (httpx.TransportError, ValueError):
                pass
            except Exception:
                retryable = False
            if not retryable or attempt + 1 == self._max_attempts:
                break
            time.sleep(self._retry_delay_seconds * (2**attempt))
        logger.warning(
            "Application trace batch was not acknowledged; run_id=%s batch_id=%s", batch.run_id, batch.batch_id
        )
        return False

    def finish_invocation(self, run_id: UUID, invocation_id: UUID) -> bool:
        """Retry pending data, then acknowledge completion only after all data."""
        with self._delivery_lock:
            successful = True
            for batch_id, batch in tuple(self._pending.items()):
                if (batch.run_id, batch.invocation_id) != (run_id, invocation_id):
                    continue
                if not self._deliver(batch):
                    successful = False
                del self._pending[batch_id]
            with self._state_lock:
                incomplete = (run_id, invocation_id) in self._incomplete_runs
            if not successful or incomplete:
                self.mark_incomplete((run_id, invocation_id))
                return False
            return self._deliver(
                AgentTraceBatch(
                    run_id=run_id,
                    invocation_id=invocation_id,
                    batch_id=uuid5(invocation_id, "final"),
                    spans=[],
                    final=True,
                )
            )

    @override
    def shutdown(self) -> None:
        with self._delivery_lock:
            for batch in self._pending.values():
                self._deliver(batch)
            self._pending.clear()
            with self._state_lock:
                self._incomplete_runs.clear()
            if self._owns_client:
                self._client.close()

    @override
    def force_flush(self, timeout_millis: int = 30000) -> bool:
        # Delivery is synchronous; the processor owns buffering and flush order.
        return True


class ApplicationBatchSpanProcessor(SpanProcessor):
    """Batch spans without silently declaring a queue-overflowed run complete.

    OTel's default batch processor silently drops oldest spans on overflow. This
    collector must tell the API whether a run is complete, so a drop suppresses
    its final marker. Network I/O is confined to the worker/explicit flush thread.
    """

    def __init__(
        self,
        exporter: JSONSpanExporter,
        *,
        max_queue_size: int = 2048,
        max_export_batch_size: int = 128,
        schedule_delay_seconds: float = 1.0,
    ) -> None:
        self.exporter = exporter
        self._max_queue_size = max_queue_size
        self._max_export_batch_size = max_export_batch_size
        self._schedule_delay_seconds = schedule_delay_seconds
        self._queue: deque[ReadableSpan] = deque()
        self._started_invocations: set[tuple[UUID, UUID]] = set()
        self._condition = threading.Condition()
        self._export_lock = threading.Lock()
        self._stopping = False
        self._worker_thread = threading.Thread(target=self._worker, name="dify-application-traces", daemon=True)
        self._worker_thread.start()

    @override
    def on_start(self, span: Span, parent_context: Context | None = None) -> None:
        if (span.attributes or {}).get("gen_ai.operation.name") == "invoke_agent":
            if scope := _scope(span):
                with self._condition:
                    self._started_invocations.add(scope)

    def invocation_started(self, scope: tuple[UUID, UUID]) -> bool:
        with self._condition:
            return scope in self._started_invocations

    def release_invocation(self, scope: tuple[UUID, UUID]) -> None:
        with self._condition:
            self._started_invocations.discard(scope)

    @override
    def on_end(self, span: ReadableSpan) -> None:
        with self._condition:
            if self._stopping or len(self._queue) >= self._max_queue_size:
                if scope := _scope(span):
                    self.exporter.mark_incomplete(scope)
                return
            self._queue.append(span)
            if len(self._queue) >= self._max_export_batch_size:
                self._condition.notify()

    def _drain_locked(self) -> None:
        # Flush a finite snapshot: unrelated busy runs must not indefinitely
        # extend a completed invocation's finalization barrier.
        with self._condition:
            remaining = len(self._queue)
        while remaining:
            with self._condition:
                batch = [self._queue.popleft() for _ in range(min(remaining, self._max_export_batch_size))]
            remaining -= len(batch)
            if not batch:
                return
            try:
                self.exporter.export(batch)
            except Exception:
                for span in batch:
                    if scope := _scope(span):
                        self.exporter.mark_incomplete(scope)
                logger.warning("Application trace batch export failed", exc_info=True)

    def _worker(self) -> None:
        try:
            while True:
                with self._condition:
                    if not self._stopping and len(self._queue) < self._max_export_batch_size:
                        self._condition.wait(self._schedule_delay_seconds)
                    stopping = self._stopping
                with self._export_lock:
                    self._drain_locked()
                if stopping:
                    return
        finally:
            self.exporter.shutdown()

    @override
    def force_flush(self, timeout_millis: int = 30000) -> bool:
        if not self._export_lock.acquire(timeout=timeout_millis / 1000):
            return False
        try:
            self._drain_locked()
            return True
        finally:
            self._export_lock.release()

    @override
    def shutdown(self) -> None:
        with self._condition:
            self._stopping = True
            self._condition.notify_all()
        self._worker_thread.join(timeout=10)


__all__ = [
    "ApplicationBatchSpanProcessor",
    "DIFY_TRACING_RUN_ID_ATTRIBUTE",
    "DIFY_TRACING_INVOCATION_ID_ATTRIBUTE",
    "JSONSpanExporter",
]
