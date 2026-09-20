"""Best-effort lifecycle diagnostics and the shared usage ingestion client.

Each application observation directly awaits one bounded HTTP request. Failed
requests are logged and discarded without a queue, worker or retry. Business
cancellation propagates; E2B callers retain ownership of resource cleanup.
Provider execution events are collected separately.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import logging
import math
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
        # retries stable provider IDs; direct observations are attempted once.
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
class DirectRuntimeUsageObserver:
    """Await one diagnostic request, without buffering or background delivery."""

    client: RuntimeUsageClient
    timeout_seconds: float = 1.0

    def __post_init__(self) -> None:
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("sandbox usage timeout must be finite and positive")

    async def observe_safely(self, event: dict[str, Any]) -> None:
        # Cancellation cleanup takes priority over optional diagnostics. Do not
        # consume or clear the task's cancellation: callers still own it.
        task = asyncio.current_task()
        if task is not None and task.cancelling():
            return
        try:
            payload = json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            if not isinstance(event.get("id"), str) or not event["id"]:
                raise ValueError("sandbox usage event requires stable id")
            if len(payload.encode()) > _MAX_EVENT_BYTES:
                raise ValueError("sandbox usage event exceeds size limit")
            async with asyncio.timeout(self.timeout_seconds):
                await self.client.post_events([event])
        except Exception as exc:
            # No retry or retained copy. Avoid contents and exception messages,
            # which may include credentials. Business cancellation propagates.
            logger.warning("sandbox usage observation dropped", extra={"error_type": type(exc).__name__})


def utc_now() -> datetime:
    return datetime.now(UTC)
