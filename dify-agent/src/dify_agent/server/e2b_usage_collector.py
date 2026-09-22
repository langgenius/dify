"""A single bounded E2B event scan, invoked by the existing Celery Beat schedule.

Offsets are used within one bounded scan only. Every scan starts at zero, with
an overlap window and periodic rescan of the provider retention window. Neither
redelivery nor overlapping scheduled scans can inflate the API's idempotent
execution ledger. A partial scan never advances coverage.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
from typing import Any, Callable
from uuid import uuid4

import httpx

from dify_agent.server.e2b_usage_client import E2BUsageApiClient, utc_now

logger = logging.getLogger(__name__)
_PROVIDER_RETENTION = timedelta(days=7)
_EVENTS_URL = "https://api.e2b.app/events/sandboxes"


def _field(event: dict[str, Any], camel: str, snake: str) -> Any:
    return event.get(camel, event.get(snake))


def _timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("provider event timestamp is invalid")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.utcoffset() is None:
        raise ValueError("provider event timestamp must have a timezone")
    return parsed


def provider_event(raw: dict[str, Any], *, project_id: str) -> dict[str, Any]:
    """Preserve the raw provider payload; API owns normalization and T0 filtering."""
    project = _field(raw, "sandboxTeamId", "sandbox_team_id")
    if project != project_id:
        raise ValueError("E2B event project mismatch or missing project")
    event_id = raw.get("id")
    event_type = raw.get("type")
    if not isinstance(event_id, str) or not event_id or not isinstance(event_type, str):
        raise ValueError("E2B event missing stable identity")
    _timestamp(raw.get("timestamp"))
    return {
        "id": event_id,
        "source": "provider",
        "type": event_type,
        "timestamp": raw.get("timestamp"),
        "sandbox_id": _field(raw, "sandboxId", "sandbox_id"),
        "execution_id": _field(raw, "sandboxExecutionId", "sandbox_execution_id"),
        "payload": raw,
    }


@dataclass(slots=True)
class E2BUsageCollector:
    provider_client: httpx.AsyncClient
    usage_client: E2BUsageApiClient
    api_key: str
    project_id: str
    overlap_seconds: int = 900
    full_scan_interval_seconds: int = 3600
    max_pages: int = 1000
    clock: Callable[[], datetime] = utc_now

    async def collect_once(self) -> bool:
        state = await self.usage_client.get_state()
        if not state.enabled:
            return False
        if state.started_at is None or state.project_id != self.project_id:
            raise ValueError("sandbox usage activation/project state is invalid")
        now = self.clock()
        if state.started_at > now:
            return False
        retention_floor = now - _PROVIDER_RETENTION
        full = (
            state.full_scan_at is None or (now - state.full_scan_at).total_seconds() >= self.full_scan_interval_seconds
        )
        anchor = state.started_at if full else (state.checkpoint_at or state.started_at)
        lower = max(state.started_at, retention_floor, anchor - timedelta(seconds=self.overlap_seconds))
        if (state.checkpoint_at or state.started_at) < retention_floor:
            # The API checkpoint also records window_start, so a retention gap is
            # visible instead of being misrepresented as complete T0 coverage.
            logger.error("sandbox usage collection gap exceeds provider retention")
            await self.usage_client.post_events(
                [
                    {
                        "id": str(uuid4()),
                        "source": "application",
                        "type": "collector_retention_gap",
                        "timestamp": now.isoformat(),
                        "payload": {
                            "uncovered_start": (state.checkpoint_at or state.started_at).isoformat(),
                            "uncovered_end": retention_floor.isoformat(),
                            "assumed_retention_seconds": int(_PROVIDER_RETENTION.total_seconds()),
                        },
                    }
                ]
            )
        count = 0
        complete = False
        pages = 0
        for page in range(self.max_pages):
            response = await self.provider_client.get(
                _EVENTS_URL,
                headers={"X-API-Key": self.api_key},
                params={"limit": 100, "offset": page * 100, "orderAsc": "false"},
                timeout=15.0,
            )
            response.raise_for_status()
            raw_events = response.json()
            if not isinstance(raw_events, list) or len(raw_events) > 100:
                raise ValueError("E2B events response must be a page of up to 100 events")
            pages += 1
            events: list[dict[str, Any]] = []
            all_older = bool(raw_events)
            for raw in raw_events:
                if not isinstance(raw, dict):
                    raise ValueError("invalid E2B event")
                event = provider_event(raw, project_id=self.project_id)
                occurred = _timestamp(raw.get("timestamp"))
                if occurred is None or occurred >= lower:
                    all_older = False
                    events.append(event)
            if events:
                await self.usage_client.post_events(events)
                count += len(events)
            if len(raw_events) < 100 or all_older:
                complete = True
                break
        if not complete:
            logger.warning("sandbox usage scan reached page bound; checkpoint unchanged", extra={"pages": pages})
            return False
        await self.usage_client.post_events(
            [
                {
                    "id": str(uuid4()),
                    "source": "application",
                    "type": "collector_checkpoint",
                    "timestamp": now.isoformat(),
                    "payload": {
                        "scan_started_at": now.isoformat(),
                        "window_start": lower.isoformat(),
                        "window_end": now.isoformat(),
                        "completed": True,
                        "mode": "full" if full else "incremental",
                        "pages": pages,
                        "events": count,
                    },
                }
            ]
        )
        return True
