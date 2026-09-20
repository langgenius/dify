"""Bounded, fail-open lifecycle observation and durable inner-API delivery.

This stream has no run TTL or automatic trim. Entries are deleted only after the
API confirms its database commit. Concurrent dispatchers can redeliver a batch;
stable event IDs make that safe. Redis durability remains an operator concern,
and enqueue failures are visible rather than being presented as lossless capture.
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
from redis.asyncio import Redis

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
        # here covers both provider pages and outbox batches. Partial success is
        # safe: callers retry stable IDs and acknowledge only after all chunks.
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
class BufferedRuntimeUsageObserver:
    redis: Redis
    project_id: str
    prefix: str = "dify-agent"
    buffer_size: int = 1000
    redis_timeout_seconds: float = 5.0
    retry_interval_seconds: float = 5.0
    dropped_events: int = field(default=0, init=False)
    failed_flushes: int = field(default=0, init=False)
    _queue: asyncio.Queue[str] = field(init=False)

    def __post_init__(self) -> None:
        if self.buffer_size < 1:
            raise ValueError("sandbox usage buffer size must be positive")
        self._queue = asyncio.Queue(maxsize=self.buffer_size)

    @property
    def stream_key(self) -> str:
        return f"{self.prefix}:sandbox-usage:{self.project_id}:outbox"

    async def observe_safely(self, event: dict[str, Any]) -> None:
        """Enqueue without suspension, so cancellation cannot strand an E2B handle.

        The small local diagnostic buffer is not durable until the flusher XADD
        succeeds. Overflow/crash can lose observations; provider events and the
        independently committed API allocation recover authoritative usage.
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
        while True:
            payload = await self._queue.get()
            while True:
                try:
                    async with asyncio.timeout(self.redis_timeout_seconds):
                        await self.redis.xadd(self.stream_key, {"event": payload})
                    self._queue.task_done()
                    break
                except Exception as exc:
                    self.failed_flushes += 1
                    logger.warning("sandbox usage Redis flush failed", extra={"error_type": type(exc).__name__})
                    await asyncio.sleep(self.retry_interval_seconds)

    async def flush_on_shutdown(self, timeout_seconds: float = 2.0) -> None:
        try:
            async with asyncio.timeout(timeout_seconds):
                await self._queue.join()
        except TimeoutError:
            logger.warning("sandbox usage local buffer not fully durable at shutdown")


@dataclass(slots=True)
class RuntimeUsageDispatcher:
    redis: Redis
    observer: BufferedRuntimeUsageObserver
    client: RuntimeUsageClient
    retry_interval_seconds: float = 5.0

    async def dispatch_once(self) -> int:
        entries = await self.redis.xrange(self.observer.stream_key, count=100)
        if not entries:
            return 0
        events: list[dict[str, Any]] = []
        ids: list[Any] = []
        for entry_id, fields in entries:
            raw = fields.get(b"event", fields.get("event"))
            event = json.loads(raw)
            if not isinstance(event, dict):
                raise ValueError("sandbox usage outbox contains invalid event")
            if events and len(self.client._encode_batch([*events, event])) > _MAX_BATCH_BYTES:
                break
            events.append(event)
            ids.append(entry_id)
        await self.client.post_events(events)
        await self.redis.xdel(self.observer.stream_key, *ids)
        pending = await self.redis.xlen(self.observer.stream_key)
        if pending >= 1000:
            logger.warning("sandbox usage delivery backlog", extra={"pending_events": pending})
        return len(ids)

    async def run(self) -> None:
        while True:
            try:
                async with asyncio.timeout(30):
                    sent = await self.dispatch_once()
                if sent:
                    continue
            except Exception as exc:
                logger.warning(
                    "sandbox usage delivery failed; batch retained", extra={"error_type": type(exc).__name__}
                )
            await asyncio.sleep(self.retry_interval_seconds)


def utc_now() -> datetime:
    return datetime.now(UTC)
