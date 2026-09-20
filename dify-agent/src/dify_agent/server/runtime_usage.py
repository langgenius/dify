"""Best-effort lifecycle diagnostics and the shared usage ingestion client.

Application observations use a bounded, process-local queue and direct HTTP
delivery. Overflow, network failure, shutdown, or restart can lose these logs;
they are not retried or persisted locally. Authoritative E2B execution events
are collected separately and do not depend on this diagnostic sender.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
import json
import logging
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)
_MAX_EVENT_BYTES = 64 * 1024
_MAX_BATCH_BYTES = 1024 * 1024


class UsageState(BaseModel):
    enabled: bool
    project_id: str
    started_at: datetime | None = None
    checkpoint_at: datetime | None = None
    full_scan_at: datetime | None = None

    model_config = ConfigDict(extra="ignore")


class _IngestResult(BaseModel):
    accepted: int = Field(ge=0)
    duplicates: int = Field(ge=0)
    conflicts: int = Field(ge=0)
    ignored: int = Field(ge=0)


@dataclass(slots=True)
class RuntimeUsageClient:
    """Borrow the lifespan-owned inner client; credentials never reach E2B."""

    client: httpx.AsyncClient
    base_url: str
    api_key: str
    project_id: str

    async def get_state(self) -> UsageState:
        response = await self.client.get(
            f"{self.base_url.rstrip('/')}/inner/api/agent/sandbox-usage/state",
            params={"project_id": self.project_id},
            headers={"X-Inner-Api-Key": self.api_key},
            timeout=15.0,
        )
        response.raise_for_status()
        state = UsageState.model_validate(response.json())
        if state.project_id != self.project_id:
            raise ValueError("sandbox usage state project mismatch")
        for value in (state.started_at, state.checkpoint_at, state.full_scan_at):
            if value is not None and value.utcoffset() is None:
                raise ValueError("sandbox usage state requires timezone-aware timestamps")
        if state.enabled and state.started_at is None:
            raise ValueError("enabled sandbox usage state requires a fixed activation time")
        return state

    async def post_events(self, events: list[dict[str, Any]]) -> None:
        if not events or len(events) > 100:
            raise ValueError("sandbox usage batches require 1 to 100 events")
        # The API limits the whole HTTP body, not just its event count. Splitting
        # here covers provider pages and application observations. The collector
        # retries stable provider IDs; the best-effort sender drops failed batches.
        batch: list[dict[str, Any]] = []
        for event in events:
            candidate = [*batch, event]
            body = self._encode_batch(candidate)
            if len(body) > _MAX_BATCH_BYTES:
                if not batch:
                    raise ValueError("sandbox usage event exceeds API request size")
                await self._post_batch(self._encode_batch(batch), len(batch))
                batch = [event]
                if len(self._encode_batch(batch)) > _MAX_BATCH_BYTES:
                    raise ValueError("sandbox usage event exceeds API request size")
            else:
                batch = candidate
        if batch:
            await self._post_batch(self._encode_batch(batch), len(batch))

    def _encode_batch(self, events: list[dict[str, Any]]) -> bytes:
        return json.dumps(
            {"project_id": self.project_id, "events": events},
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode()

    async def _post_batch(self, body: bytes, count: int) -> None:
        response = await self.client.post(
            f"{self.base_url.rstrip('/')}/inner/api/agent/sandbox-usage/events",
            headers={"X-Inner-Api-Key": self.api_key, "Content-Type": "application/json"},
            content=body,
            timeout=15.0,
        )
        response.raise_for_status()
        result = _IngestResult.model_validate(response.json())
        if result.accepted + result.duplicates + result.conflicts + result.ignored != count:
            raise ValueError("sandbox usage acknowledgement does not cover the entire batch")
        if result.conflicts:
            logger.error("sandbox usage ingestion reported conflicts", extra={"conflicts": result.conflicts})


@dataclass(slots=True)
class BestEffortRuntimeUsageObserver:
    client: RuntimeUsageClient
    buffer_size: int = 1000
    send_timeout_seconds: float = 15.0
    dropped_events: int = field(default=0, init=False)
    failed_batches: int = field(default=0, init=False)
    _queue: asyncio.Queue[str] = field(init=False)

    def __post_init__(self) -> None:
        if self.buffer_size < 1:
            raise ValueError("sandbox usage buffer size must be positive")
        if self.send_timeout_seconds <= 0:
            raise ValueError("sandbox usage send timeout must be positive")
        self._queue = asyncio.Queue(maxsize=self.buffer_size)

    async def observe_safely(self, event: dict[str, Any]) -> None:
        """Enqueue without suspension, so cancellation cannot strand an E2B handle.

        This queue is intentionally lossy. It snapshots only diagnostic event
        data; delivery never adds a cancellation point to an E2B lifecycle call.
        """
        try:
            payload = json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            if not isinstance(event.get("id"), str) or not event["id"]:
                raise ValueError("sandbox usage event requires stable id")
            if len(payload.encode()) > _MAX_EVENT_BYTES:
                raise ValueError("sandbox usage event exceeds size limit")
            self._queue.put_nowait(payload)
        except Exception as exc:
            self.dropped_events += 1
            # Do not log event contents or raw exception text: they can contain data.
            logger.warning("sandbox usage enqueue failed", extra={"error_type": type(exc).__name__})

    async def run(self) -> None:
        try:
            while True:
                payloads = [await self._queue.get()]
                while len(payloads) < 100:
                    try:
                        payloads.append(self._queue.get_nowait())
                    except asyncio.QueueEmpty:
                        break
                try:
                    async with asyncio.timeout(self.send_timeout_seconds):
                        await self.client.post_events([json.loads(payload) for payload in payloads])
                except asyncio.CancelledError:
                    self._record_dropped_batch(len(payloads), "CancelledError")
                    raise
                except Exception as exc:
                    self._record_dropped_batch(len(payloads), type(exc).__name__)
                finally:
                    for _ in payloads:
                        self._queue.task_done()
        finally:
            # Shutdown does not retain local observations for a future process.
            pending = 0
            while True:
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                self._queue.task_done()
                pending += 1
            if pending:
                self.dropped_events += pending
                logger.warning("sandbox usage queued observations dropped on shutdown", extra={"events": pending})

    def _record_dropped_batch(self, count: int, error_type: str) -> None:
        self.failed_batches += 1
        self.dropped_events += count
        # The remote API may have committed before an ACK was lost. This is the
        # number abandoned locally, not a claim that none reached the database.
        logger.warning(
            "sandbox usage observation batch dropped without retry",
            extra={"events": count, "error_type": error_type},
        )

    async def flush_on_shutdown(self, timeout_seconds: float = 2.0) -> None:
        try:
            async with asyncio.timeout(timeout_seconds):
                await self._queue.join()
        except TimeoutError:
            logger.warning("sandbox usage shutdown drain timed out; remaining observations will be dropped")


def utc_now() -> datetime:
    return datetime.now(UTC)
