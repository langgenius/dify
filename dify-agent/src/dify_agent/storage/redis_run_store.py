"""Redis-backed run records and per-run event streams.

The store writes status-only run records as JSON strings and events as Redis
streams. HTTP event cursors are Redis stream ids; ``0-0`` means replay from the
beginning for polling and SSE. Records and streams share one retention window
that is refreshed when status or event data is written. Execution is scheduled
in-process by ``dify_agent.runtime.run_scheduler``; Redis is not a job queue, and
create-run payloads are never persisted because layer config may include model
credentials.
"""

from collections.abc import AsyncIterator, Awaitable
from typing import cast

from redis.asyncio import Redis

from dify_agent.protocol.schemas import RUN_EVENT_ADAPTER, RunEvent, RunEventsResponse, RunStatus
from dify_agent.runtime.event_sink import (
    NonTerminalRunEvent,
    RunEventSink,
    RunFinalizationResult,
    TerminalRunEvent,
    terminal_event_status_and_error,
)
from dify_agent.server.schemas import RunRecord, new_run_id
from dify_agent.server.settings import DEFAULT_RUN_RETENTION_SECONDS
from dify_agent.storage.redis_keys import run_events_key, run_record_key

_TERMINAL_RUN_EVENT_TYPES = {"run_succeeded", "run_failed", "run_cancelled"}


class RunNotFoundError(LookupError):
    """Raised when a requested run record does not exist."""


_FINALIZE_RUN_SCRIPT = """
local record_json = redis.call("GET", KEYS[1])
if not record_json then
    return {-1, "", ""}
end

local record = cjson.decode(record_json)
if record.status ~= "running" then
    return {0, tostring(record.status), ""}
end

record.status = ARGV[1]
record.updated_at = ARGV[2]
if ARGV[3] == "1" then
    record.error = ARGV[4]
else
    record.error = cjson.null
end

local ttl = tonumber(ARGV[6])
local updated_record_json = cjson.encode(record)
local event_id = redis.call("XADD", KEYS[2], "*", "payload", ARGV[5])
redis.call("EXPIRE", KEYS[2], ttl)
redis.call("SET", KEYS[1], updated_record_json, "EX", ttl)
return {1, ARGV[1], event_id}
"""


class RedisRunStore(RunEventSink):
    """Async Redis implementation for run records and event logs.

    ``run_retention_seconds`` is applied to both the run record key and the
    per-run Redis stream. Event writes run ``XADD`` and both TTL refreshes in one
    Redis transaction so a newly created stream is not left without expiration if
    the client is interrupted between commands. Event writes also refresh the
    record TTL so long-running runs that keep producing events do not lose their
    status record mid-run.
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

    async def append_event(self, event: NonTerminalRunEvent) -> str:
        """Append a non-terminal event JSON payload with refreshed TTLs."""
        events_key = run_events_key(self.prefix, event.run_id)
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        async with self.redis.pipeline(transaction=True) as pipeline:
            _ = pipeline.xadd(
                events_key,
                {"payload": payload},
            )
            _ = pipeline.expire(events_key, self.run_retention_seconds)
            _ = pipeline.expire(run_record_key(self.prefix, event.run_id), self.run_retention_seconds)
            results = cast(list[object], await pipeline.execute())
        event_id = results[0]
        return event_id.decode() if isinstance(event_id, bytes) else str(event_id)

    async def finalize_run(self, event: TerminalRunEvent) -> RunFinalizationResult:
        """Atomically append the first terminal event and update its run record."""
        status, error = terminal_event_status_and_error(event)
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        evaluation = cast(
            Awaitable[object],
            self.redis.eval(
                _FINALIZE_RUN_SCRIPT,
                2,
                run_record_key(self.prefix, event.run_id),
                run_events_key(self.prefix, event.run_id),
                status,
                event.created_at.isoformat(),
                "1" if error is not None else "0",
                error or "",
                payload,
                str(self.run_retention_seconds),
            ),
        )
        raw_result = await evaluation
        result = cast(list[object], raw_result)
        applied = int(cast(int | bytes | str, result[0]))
        if applied == -1:
            raise RunNotFoundError(event.run_id)

        persisted_status = cast(RunStatus, _decode_redis_text(result[1]))
        event_id = _decode_redis_text(result[2]) or None
        return RunFinalizationResult(
            applied=applied == 1,
            status=persisted_status,
            event_id=event_id,
        )

    async def wait_for_cancellation(self, run_id: str) -> bool:
        """Wait until cancellation or another terminal state wins for one run.

        The stream cursor is captured before reading the record so a terminal
        transition cannot fall between the initial status check and blocking
        stream read.
        """
        events_key = run_events_key(self.prefix, run_id)
        latest_events = await self.redis.xrevrange(events_key, count=1)
        cursor = _decode_redis_text(latest_events[0][0]) if latest_events else "0-0"
        record = await self.get_run(run_id)
        if record.status != "running":
            return record.status == "cancelled"

        while True:
            response = await self.redis.xread({events_key: cursor}, block=0, count=100)
            for _stream_name, entries in response:
                for raw_id, fields in entries:
                    event = self._decode_event(run_id, raw_id, fields)
                    if event.id is not None:
                        cursor = event.id
                    if event.type == "run_cancelled":
                        return True
                    if event.type in {"run_succeeded", "run_failed"}:
                        return False

    async def get_events(self, run_id: str, *, after: str = "0-0", limit: int = 100) -> RunEventsResponse:
        """Read a bounded page of events after ``after`` cursor."""
        await self.get_run(run_id)
        raw_events = await self.redis.xrange(run_events_key(self.prefix, run_id), min=f"({after}", count=limit)
        events = [self._decode_event(run_id, raw_id, fields) for raw_id, fields in raw_events]
        next_cursor = events[-1].id if events else after
        return RunEventsResponse(run_id=run_id, events=events, next_cursor=next_cursor)

    async def iter_events(self, run_id: str, *, after: str = "0-0") -> AsyncIterator[RunEvent]:
        """Yield replayed and future events through the first terminal event."""
        await self.get_run(run_id)
        cursor = after
        while True:
            page = await self.get_events(run_id, after=cursor, limit=100)
            for event in page.events:
                if event.id is not None:
                    cursor = event.id
                yield event
                if event.type in _TERMINAL_RUN_EVENT_TYPES:
                    return
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
                    if event.type in _TERMINAL_RUN_EVENT_TYPES:
                        return

    @staticmethod
    def _decode_event(run_id: str, raw_id: object, fields: dict[object, object]) -> RunEvent:
        """Decode one Redis stream entry into a public event."""
        payload = fields.get(b"payload") or fields.get("payload")
        if isinstance(payload, bytes):
            payload = payload.decode()
        event_id = raw_id.decode() if isinstance(raw_id, bytes) else str(raw_id)
        event = RUN_EVENT_ADAPTER.validate_json(cast(str, payload))
        return event.model_copy(update={"id": event_id, "run_id": run_id})


def _decode_redis_text(value: object) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


__all__ = ["DEFAULT_RUN_RETENTION_SECONDS", "RedisRunStore", "RunNotFoundError"]
