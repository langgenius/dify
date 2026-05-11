"""Redis-backed run records and per-run event streams.

The store writes run records as JSON strings and events as Redis streams. HTTP
event cursors are Redis stream ids; ``0-0`` means replay from the beginning for
polling and SSE. Execution is scheduled in-process by
``dify_agent.runtime.run_scheduler``; Redis is not a job queue.
"""

from collections.abc import AsyncIterator
from typing import cast

from redis.asyncio import Redis

from dify_agent.runtime.event_sink import RunEventSink
from dify_agent.server.schemas import (
    CreateRunRequest,
    RUN_EVENT_ADAPTER,
    RunEvent,
    RunEventsResponse,
    RunRecord,
    RunStatus,
    new_run_id,
    utc_now,
)
from dify_agent.storage.redis_keys import run_events_key, run_record_key


class RunNotFoundError(LookupError):
    """Raised when a requested run record does not exist."""


class RedisRunStore(RunEventSink):
    """Async Redis implementation for run records and event logs."""

    redis: Redis
    prefix: str

    def __init__(self, redis: Redis, *, prefix: str = "dify-agent") -> None:
        self.redis = redis
        self.prefix = prefix

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        """Persist a running run record without enqueueing external work."""
        run_id = new_run_id()
        record = RunRecord(run_id=run_id, status="running", request=request)
        await self.redis.set(run_record_key(self.prefix, run_id), record.model_dump_json())
        return record

    async def get_run(self, run_id: str) -> RunRecord:
        """Return one run record or raise ``RunNotFoundError``."""
        value = await self.redis.get(run_record_key(self.prefix, run_id))
        if value is None:
            raise RunNotFoundError(run_id)
        if isinstance(value, bytes):
            value = value.decode()
        return RunRecord.model_validate_json(value)

    async def update_status(self, run_id: str, status: RunStatus, error: str | None = None) -> None:
        """Update the status fields of an existing run record."""
        record = await self.get_run(run_id)
        updated = record.model_copy(update={"status": status, "updated_at": utc_now(), "error": error})
        await self.redis.set(run_record_key(self.prefix, run_id), updated.model_dump_json())

    async def append_event(self, event: RunEvent) -> str:
        """Append an event JSON payload to the run's Redis stream."""
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        event_id = await self.redis.xadd(
            run_events_key(self.prefix, event.run_id),
            {"payload": payload},
        )
        return event_id.decode() if isinstance(event_id, bytes) else str(event_id)

    async def get_events(self, run_id: str, *, after: str = "0-0", limit: int = 100) -> RunEventsResponse:
        """Read a bounded page of events after ``after`` cursor."""
        await self.get_run(run_id)
        raw_events = await self.redis.xrange(run_events_key(self.prefix, run_id), min=f"({after}", count=limit)
        events = [self._decode_event(run_id, raw_id, fields) for raw_id, fields in raw_events]
        next_cursor = events[-1].id if events else after
        return RunEventsResponse(run_id=run_id, events=events, next_cursor=next_cursor)

    async def iter_events(self, run_id: str, *, after: str = "0-0") -> AsyncIterator[RunEvent]:
        """Yield replayed and future events for SSE clients."""
        await self.get_run(run_id)
        cursor = after
        while True:
            page = await self.get_events(run_id, after=cursor, limit=100)
            for event in page.events:
                if event.id is not None:
                    cursor = event.id
                yield event
            if not page.events:
                break
        while True:
            response = await self.redis.xread({run_events_key(self.prefix, run_id): cursor}, block=30_000, count=100)
            if not response:
                continue
            for _stream_name, entries in response:
                for raw_id, fields in entries:
                    event = self._decode_event(run_id, raw_id, fields)
                    if event.id is not None:
                        cursor = event.id
                    yield event

    @staticmethod
    def _decode_event(run_id: str, raw_id: object, fields: dict[object, object]) -> RunEvent:
        """Decode one Redis stream entry into a public event."""
        payload = fields.get(b"payload") or fields.get("payload")
        if isinstance(payload, bytes):
            payload = payload.decode()
        event_id = raw_id.decode() if isinstance(raw_id, bytes) else str(raw_id)
        event = RUN_EVENT_ADAPTER.validate_json(cast(str, payload))
        return event.model_copy(update={"id": event_id, "run_id": run_id})


__all__ = ["RedisRunStore", "RunNotFoundError"]
