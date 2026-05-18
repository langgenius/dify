"""Redis-backed run records and per-run event streams.

The store writes status-only run records as JSON strings and events as Redis
streams. HTTP event cursors are Redis stream ids; ``0-0`` means replay from the
beginning for polling and SSE. Records and streams share one retention window
that is refreshed when status or event data is written. Execution is scheduled
in-process by ``dify_agent.runtime.run_scheduler``; Redis is not a job queue, and
create-run payloads are never persisted because layer config may include model
credentials.
"""

from collections.abc import AsyncIterator
from typing import cast

from redis.asyncio import Redis

from dify_agent.protocol.schemas import RUN_EVENT_ADAPTER, RunEvent, RunEventsResponse, RunStatus, utc_now
from dify_agent.runtime.event_sink import RunEventSink
from dify_agent.server.schemas import RunRecord, new_run_id
from dify_agent.server.settings import DEFAULT_RUN_RETENTION_SECONDS
from dify_agent.storage.redis_keys import run_events_key, run_record_key


class RunNotFoundError(LookupError):
    """Raised when a requested run record does not exist."""


class RedisRunStore(RunEventSink):
    """Async Redis implementation for run records and event logs.

    ``run_retention_seconds`` is applied to both the run record key and the
    per-run Redis stream. Event writes also refresh the record TTL so long-running
    runs that keep producing events do not lose their status record mid-run.
    """

    redis: Redis
    prefix: str
    run_retention_seconds: int

    def __init__(
        self,
        redis: Redis,
        *,
        prefix: str = "dify-agent",
        run_retention_seconds: int = DEFAULT_RUN_RETENTION_SECONDS,
    ) -> None:
        if run_retention_seconds <= 0:
            raise ValueError("run_retention_seconds must be positive")
        self.redis = redis
        self.prefix = prefix
        self.run_retention_seconds = run_retention_seconds

    async def create_run(self) -> RunRecord:
        """Persist a running run record without storing the create request."""
        run_id = new_run_id()
        record = RunRecord(run_id=run_id, status="running")
        await self.redis.set(
            run_record_key(self.prefix, run_id),
            record.model_dump_json(),
            ex=self.run_retention_seconds,
        )
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
        await self.redis.set(
            run_record_key(self.prefix, run_id),
            updated.model_dump_json(),
            ex=self.run_retention_seconds,
        )

    async def append_event(self, event: RunEvent) -> str:
        """Append an event JSON payload to the run's Redis stream."""
        events_key = run_events_key(self.prefix, event.run_id)
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        event_id = await self.redis.xadd(
            events_key,
            {"payload": payload},
        )
        await self.redis.expire(events_key, self.run_retention_seconds)
        await self.redis.expire(run_record_key(self.prefix, event.run_id), self.run_retention_seconds)
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


__all__ = ["DEFAULT_RUN_RETENTION_SECONDS", "RedisRunStore", "RunNotFoundError"]
