"""Redis-backed run records, event streams, and private cancellation intents.

The store writes status-only run records as JSON strings and events as Redis
streams. HTTP event cursors are Redis stream ids; ``0-0`` means replay from the
beginning for polling and SSE. Records, event streams, and intents share one retention window
that is refreshed when status or event data is written. Execution is scheduled
in-process by ``dify_agent.runtime.run_scheduler``; Redis is not a job queue, and
create-run payloads are never persisted because layer config may include
sensitive runtime configuration.
"""

from collections.abc import AsyncIterator, Awaitable
import hashlib
import json
from uuid import uuid4
from pydantic import JsonValue
from typing import cast, override

from redis.asyncio import Redis

from dify_agent.protocol.native_testing import AgentNativeTestRef, AgentOperationKey, ContinuationClaim
from dify_agent.runtime.native_continuation import AgentCheckpoint, NativeContinuationConflict
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    RUN_EVENT_ADAPTER,
    CancelRunRequest,
    RunCancelledEvent,
    RunCancelledEventData,
    RunEvent,
    RunEventsResponse,
    RunStatus,
    RunWaitingEvent,
    RunResumedEvent,
    RunResumedEventData,
    RunFailedEvent,
    RunFailedEventData,
    utc_now,
)
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.event_sink import (
    NonTerminalRunEvent,
    RunEventSink,
    RunFinalizationResult,
    TerminalRunEvent,
    terminal_event_status_fields,
)
from dify_agent.server.schemas import RunRecord, new_run_id
from dify_agent.server.settings import DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH, DEFAULT_RUN_RETENTION_SECONDS
from dify_agent.storage.redis_keys import run_cancel_intent_key, run_events_key, run_record_key

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

if redis.call("EXISTS", KEYS[3]) == 1 then
    return {-2, "running", ""}
end

record.status = ARGV[1]
record.updated_at = ARGV[2]
if ARGV[3] == "1" then
    record.error = ARGV[4]
else
    record.error = cjson.null
end
if ARGV[5] == "1" then
    record.error_type = ARGV[6]
else
    record.error_type = cjson.null
end

local ttl = tonumber(ARGV[8])
local updated_record_json = cjson.encode(record)
local event_id = redis.call("XADD", KEYS[2], "MAXLEN", "~", ARGV[9], "*", "payload", ARGV[7])
redis.call("EXPIRE", KEYS[2], ttl)
redis.call("SET", KEYS[1], updated_record_json, "EX", ttl)
return {1, ARGV[1], event_id}
"""


_REQUEST_CANCELLATION_SCRIPT = """
local record_json = redis.call("GET", KEYS[1])
if not record_json then
    return {-1, ""}
end

local record = cjson.decode(record_json)
if record.status == "succeeded" or record.status == "failed" then
    return {0, tostring(record.status)}
end
if record.status == "cancelled" then
    return {1, "cancelled"}
end
if redis.call("EXISTS", KEYS[2]) == 1 then
    return {1, tostring(record.status)}
end

local ttl = tonumber(ARGV[2])
redis.call("XADD", KEYS[2], "MAXLEN", "1", "*", "payload", ARGV[1])
redis.call("EXPIRE", KEYS[2], ttl)
redis.call("EXPIRE", KEYS[1], ttl)
redis.call("EXPIRE", KEYS[3], ttl)
return {1, tostring(record.status)}
"""


_FINALIZE_CANCELLATION_SCRIPT = """
local record_json = redis.call("GET", KEYS[1])
if not record_json then
    return {-1, "", ""}
end

local record = cjson.decode(record_json)
if record.status == "cancelled" then
    return {0, "cancelled", ""}
end
if record.status ~= "running" and record.status ~= "waiting" then
    return {0, tostring(record.status), ""}
end
if redis.call("EXISTS", KEYS[2]) == 0 then
    return {-2, "running", ""}
end

record.status = "cancelled"
record.native_checkpoint_json = cjson.null
record.native_claim = cjson.null
record.updated_at = ARGV[1]
if ARGV[2] == "1" then
    record.error = ARGV[3]
else
    record.error = cjson.null
end
record.error_type = cjson.null

local ttl = tonumber(ARGV[5])
local event_id = redis.call("XADD", KEYS[3], "MAXLEN", "~", ARGV[6], "*", "payload", ARGV[4])
redis.call("DEL", KEYS[2])
redis.call("EXPIRE", KEYS[3], ttl)
redis.call("SET", KEYS[1], cjson.encode(record), "EX", ttl)
return {1, "cancelled", event_id}
"""


_PERSIST_WAITING_SCRIPT = """
local raw = redis.call("GET", KEYS[1])
if not raw then return {-1, ""} end
local r = cjson.decode(raw)
local cp = cjson.decode(ARGV[1])
if r.status ~= "running" or redis.call("EXISTS", KEYS[3]) == 1 or (r.native_generation or 0) ~= cp.generation then
    return {-2, ""}
end
r.native_checkpoint_json = ARGV[1]
r.status = "waiting"
r.updated_at = ARGV[3]
r.native_claim = cjson.null
r.native_dispatch_started = false
local event_id = redis.call("XADD", KEYS[2], "MAXLEN", "~", ARGV[5], "*", "payload", ARGV[2])
redis.call("EXPIRE", KEYS[2], ARGV[4])
redis.call("SET", KEYS[1], cjson.encode(r), "EX", ARGV[4])
return {1, event_id}
"""

_CLAIM_CONTINUATION_SCRIPT = """
local raw = redis.call("GET", KEYS[1])
if not raw then return {-1, ""} end
local r = cjson.decode(raw)
if redis.call("EXISTS", KEYS[2]) == 1 or r.status == "cancelled" or r.status == "failed" or r.status == "succeeded" then
    return {-2, ""}
end
local claim = cjson.decode(ARGV[1])
if r.native_claim and r.native_claim ~= cjson.null then
    if r.native_claim.generation == claim.generation and r.native_claim.idempotency_key == claim.idempotency_key then
        return {1, cjson.encode(r.native_claim)}
    end
    return {-2, ""}
end
if r.status ~= "waiting" or not r.native_checkpoint_json or r.native_checkpoint_json == cjson.null or cjson.decode(r.native_checkpoint_json).generation ~= claim.generation - 1 then
    return {-2, ""}
end
r.native_claim = claim
redis.call("SET", KEYS[1], cjson.encode(r), "EX", ARGV[2])
return {1, ARGV[1]}
"""

_START_CONTINUATION_SCRIPT = """
local raw = redis.call("GET", KEYS[1])
if not raw then return -1 end
local r = cjson.decode(raw)
if redis.call("EXISTS", KEYS[3]) == 1 or r.status == "cancelled" or r.status == "failed" or r.status == "succeeded" then
    return -2
end
if not r.native_claim or r.native_claim == cjson.null or r.native_claim.claim_id ~= ARGV[1] then return -2 end
if r.native_dispatch_started then return 0 end
if r.status ~= "waiting" then return -2 end
r.status = "running"
r.native_generation = r.native_claim.generation
r.native_dispatch_started = true
r.updated_at = ARGV[3]
redis.call("XADD", KEYS[2], "MAXLEN", "~", ARGV[5], "*", "payload", ARGV[2])
redis.call("EXPIRE", KEYS[2], ARGV[4])
redis.call("SET", KEYS[1], cjson.encode(r), "EX", ARGV[4])
return 1
"""


_STOP_NATIVE_SCRIPT = """
local raw = redis.call("GET", KEYS[1])
if not raw then return -1 end
local r = cjson.decode(raw)
if redis.call("EXISTS", KEYS[3]) == 1 or r.status ~= "waiting" or (r.native_generation or 0) ~= tonumber(ARGV[1]) then return -2 end
r.status = "failed"
r.error = ARGV[2]
r.updated_at = ARGV[3]
r.native_checkpoint_json = cjson.null
r.native_claim = cjson.null
redis.call("XADD", KEYS[2], "MAXLEN", "~", ARGV[6], "*", "payload", ARGV[4])
redis.call("EXPIRE", KEYS[2], ARGV[5])
redis.call("SET", KEYS[1], cjson.encode(r), "EX", ARGV[5])
return 1
"""


class RedisRunStore(RunEventSink):
    """Async Redis implementation for run records and event logs.

    ``run_retention_seconds`` is applied to both the run record key and the
    per-run Redis stream. Every public stream write applies an approximate
    maximum length before refreshing both TTLs, so active runs cannot grow one
    Redis key without bound without paying the CPU cost of exact per-entry
    trimming. The transaction also ensures a newly created stream is not left
    without expiration if the client is interrupted between commands.
    Event writes refresh the record TTL so long-running runs that keep producing
    events do not lose their status record mid-run.
    """

    redis: Redis
    prefix: str
    run_retention_seconds: int
    run_event_stream_max_length: int

    def __init__(
        self,
        redis: Redis,
        *,
        prefix: str = "dify-agent",
        run_retention_seconds: int = DEFAULT_RUN_RETENTION_SECONDS,
        run_event_stream_max_length: int = DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH,
    ) -> None:
        if run_retention_seconds <= 0:
            raise ValueError("run_retention_seconds must be positive")
        if run_event_stream_max_length <= 0:
            raise ValueError("run_event_stream_max_length must be positive")
        self.redis = redis
        self.prefix = prefix
        self.run_retention_seconds = run_retention_seconds
        self.run_event_stream_max_length = run_event_stream_max_length

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

    @override
    async def persist_waiting(self, *, run_id: str, checkpoint: AgentCheckpoint, event: RunWaitingEvent) -> str:
        """Commit protected checkpoint and public waiting event in one Lua CAS."""
        if run_id != checkpoint.run_id or event.run_id != run_id or event.data != checkpoint.waiting_event().data:
            raise NativeContinuationConflict("checkpoint/event identity mismatch")
        payload = checkpoint.model_dump_json()
        if len(payload.encode()) > 2**20:
            raise ValueError("native checkpoint exceeds protected payload limit")
        result = await cast(
            Awaitable[object],
            self.redis.eval(
                _PERSIST_WAITING_SCRIPT,
                3,
                run_record_key(self.prefix, run_id),
                run_events_key(self.prefix, run_id),
                run_cancel_intent_key(self.prefix, run_id),
                payload,
                event.model_dump_json(exclude={"id"}),
                event.created_at.isoformat(),
                str(self.run_retention_seconds),
                str(self.run_event_stream_max_length),
            ),
        )
        result = cast(list[object], result)
        if int(cast(int | bytes | str, result[0])) == -1:
            raise RunNotFoundError(run_id)
        if int(cast(int | bytes | str, result[0])) != 1:
            raise NativeContinuationConflict("waiting transition lost generation or cancellation")
        return _decode_redis_text(result[1])

    async def stop_native_run(self, *, run_id: str, expected_generation: int, reason_code: str) -> None:
        """Persist a trusted policy stop without giving denial back to the model."""
        event = RunFailedEvent(run_id=run_id, data=RunFailedEventData(error=reason_code, reason=reason_code))
        result = await cast(
            Awaitable[object],
            self.redis.eval(
                _STOP_NATIVE_SCRIPT,
                3,
                run_record_key(self.prefix, run_id),
                run_events_key(self.prefix, run_id),
                run_cancel_intent_key(self.prefix, run_id),
                str(expected_generation),
                reason_code,
                event.created_at.isoformat(),
                event.model_dump_json(exclude={"id"}),
                str(self.run_retention_seconds),
                str(self.run_event_stream_max_length),
            ),
        )
        if result == -1:
            raise RunNotFoundError(run_id)
        if result != 1:
            raise NativeContinuationConflict("policy stop lost generation or cancellation")

    async def get_checkpoint(self, run_id: str) -> AgentCheckpoint:
        record = await self.get_run(run_id)
        if record.native_checkpoint_json is None:
            raise NativeContinuationConflict("protected checkpoint unavailable")
        return AgentCheckpoint.model_validate_json(record.native_checkpoint_json)

    async def claim_continuation(
        self, *, run_id: str, expected_generation: int, idempotency_key: str
    ) -> ContinuationClaim:
        """Persist recoverable dispatch intent; duplicate deliveries share its ID."""
        claim = ContinuationClaim(
            run_id=run_id, generation=expected_generation + 1, idempotency_key=idempotency_key, claim_id=str(uuid4())
        )
        result = await cast(
            Awaitable[object],
            self.redis.eval(
                _CLAIM_CONTINUATION_SCRIPT,
                2,
                run_record_key(self.prefix, run_id),
                run_cancel_intent_key(self.prefix, run_id),
                claim.model_dump_json(),
                str(self.run_retention_seconds),
            ),
        )
        result = cast(list[object], result)
        if int(cast(int | bytes | str, result[0])) == -1:
            raise RunNotFoundError(run_id)
        if int(cast(int | bytes | str, result[0])) != 1:
            raise NativeContinuationConflict("continuation generation, claim or cancellation conflict")
        return ContinuationClaim.model_validate_json(_decode_redis_text(result[1]))

    async def start_continuation(self, claim: ContinuationClaim) -> bool:
        """Consume a scheduling intent once; ambiguous dispatch is never retried.

        A crash before this CAS can recover the same intent. A crash after it
        leaves running/unavailable state for the owner to reconcile, never a
        second execution. This is deliberately not a lease that expires/replays.
        """
        event = RunResumedEvent(run_id=claim.run_id, data=RunResumedEventData(generation=claim.generation))
        result = await cast(
            Awaitable[object],
            self.redis.eval(
                _START_CONTINUATION_SCRIPT,
                3,
                run_record_key(self.prefix, claim.run_id),
                run_events_key(self.prefix, claim.run_id),
                run_cancel_intent_key(self.prefix, claim.run_id),
                claim.claim_id,
                event.model_dump_json(exclude={"id"}),
                event.created_at.isoformat(),
                str(self.run_retention_seconds),
                str(self.run_event_stream_max_length),
            ),
        )
        result = cast(int, result)
        if int(result) == -1:
            raise RunNotFoundError(claim.run_id)
        if int(result) == -2:
            raise NativeContinuationConflict("continuation cancelled or claim changed")
        return int(result) == 1

    async def get_run(self, run_id: str) -> RunRecord:
        """Return one run record or raise ``RunNotFoundError``."""
        value = await self.redis.get(run_record_key(self.prefix, run_id))
        if value is None:
            raise RunNotFoundError(run_id)
        if isinstance(value, bytes):
            value = value.decode()
        return RunRecord.model_validate_json(value)

    @override
    async def append_event(self, event: NonTerminalRunEvent) -> str:
        """Append a non-terminal event JSON payload with refreshed TTLs."""
        events_key = run_events_key(self.prefix, event.run_id)
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        async with self.redis.pipeline(transaction=True) as pipeline:
            _ = pipeline.xadd(
                events_key,
                {"payload": payload},
                maxlen=self.run_event_stream_max_length,
                approximate=True,
            )
            _ = pipeline.expire(events_key, self.run_retention_seconds)
            _ = pipeline.expire(run_record_key(self.prefix, event.run_id), self.run_retention_seconds)
            results = cast(list[object], await pipeline.execute())
        event_id = results[0]
        return event_id.decode() if isinstance(event_id, bytes) else str(event_id)

    @override
    async def finalize_run(self, event: TerminalRunEvent) -> RunFinalizationResult:
        """Atomically append the first success/failure event and update its run record."""
        status, error, error_type = terminal_event_status_fields(event)
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        evaluation = cast(
            Awaitable[object],
            self.redis.eval(
                _FINALIZE_RUN_SCRIPT,
                3,
                run_record_key(self.prefix, event.run_id),
                run_events_key(self.prefix, event.run_id),
                run_cancel_intent_key(self.prefix, event.run_id),
                status,
                event.created_at.isoformat(),
                "1" if error is not None else "0",
                error or "",
                "1" if error_type is not None else "0",
                error_type.value if error_type is not None else "",
                payload,
                str(self.run_retention_seconds),
                str(self.run_event_stream_max_length),
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

    async def request_cancellation(self, run_id: str, request: CancelRunRequest) -> RunStatus:
        """Atomically persist the first cancellation intent for a running run."""
        intent = RunCancellationIntent(
            reason=request.reason,
            message=request.message,
            requested_at=utc_now(),
        )
        evaluation = cast(
            Awaitable[object],
            self.redis.eval(
                _REQUEST_CANCELLATION_SCRIPT,
                3,
                run_record_key(self.prefix, run_id),
                run_cancel_intent_key(self.prefix, run_id),
                run_events_key(self.prefix, run_id),
                intent.model_dump_json(),
                str(self.run_retention_seconds),
            ),
        )
        result = cast(list[object], await evaluation)
        if int(cast(int | bytes | str, result[0])) == -1:
            raise RunNotFoundError(run_id)
        return cast(RunStatus, _decode_redis_text(result[1]))

    async def get_cancellation_intent(self, run_id: str) -> RunCancellationIntent | None:
        """Return the accepted private cancellation intent, if one exists."""
        entries = await self.redis.xrange(run_cancel_intent_key(self.prefix, run_id), count=1)
        if not entries:
            return None
        return self._decode_cancellation_intent(entries[0][1])

    async def wait_for_cancellation(self, run_id: str) -> RunCancellationIntent:
        """Wait until the first accepted private cancellation intent is available."""
        response = await self.redis.xread(
            {run_cancel_intent_key(self.prefix, run_id): "0-0"},
            block=0,
            count=1,
        )
        return self._decode_cancellation_intent(response[0][1][0][1])

    async def finalize_cancellation(
        self,
        run_id: str,
        intent: RunCancellationIntent,
        *,
        session_snapshot: SessionSnapshot | None = None,
        usage: AgentRunUsage | None = None,
    ) -> RunFinalizationResult:
        """Atomically publish cancellation after the owner runner has exited."""
        event = RunCancelledEvent(
            run_id=run_id,
            data=RunCancelledEventData(
                reason=intent.reason,
                message=intent.message,
                session_snapshot=session_snapshot,
                usage=usage,
            ),
            created_at=utc_now(),
        )
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        error = event.data.message or event.data.reason
        evaluation = cast(
            Awaitable[object],
            self.redis.eval(
                _FINALIZE_CANCELLATION_SCRIPT,
                3,
                run_record_key(self.prefix, run_id),
                run_cancel_intent_key(self.prefix, run_id),
                run_events_key(self.prefix, run_id),
                event.created_at.isoformat(),
                "1" if error is not None else "0",
                error or "",
                payload,
                str(self.run_retention_seconds),
                str(self.run_event_stream_max_length),
            ),
        )
        result = cast(list[object], await evaluation)
        applied = int(cast(int | bytes | str, result[0]))
        if applied == -1:
            raise RunNotFoundError(run_id)
        return RunFinalizationResult(
            applied=applied == 1,
            status=cast(RunStatus, _decode_redis_text(result[1])),
            event_id=_decode_redis_text(result[2]) or None,
        )

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

    @staticmethod
    def _decode_cancellation_intent(fields: dict[object, object]) -> RunCancellationIntent:
        payload = fields.get(b"payload") or fields.get("payload")
        if isinstance(payload, bytes):
            payload = payload.decode()
        return RunCancellationIntent.model_validate_json(cast(str, payload))


def _decode_redis_text(value: object) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)


__all__ = [
    "DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH",
    "DEFAULT_RUN_RETENTION_SECONDS",
    "RedisRunStore",
    "RunNotFoundError",
]


class RedisAgentResultStore:
    """Invocation-scoped immutable results; payloads stay out of audit events.

    The server binds this owner to a trusted ref. Keys are opaque digests, reads
    check the complete owner ref, and conflicting writes fail rather than
    silently replacing a previously recorded effect result.
    """

    def __init__(
        self,
        redis: Redis,
        *,
        ref: AgentNativeTestRef,
        prefix: str = "dify-agent",
        retention_seconds: int = DEFAULT_RUN_RETENTION_SECONDS,
    ):
        self.redis = redis
        self.ref = ref
        self.prefix = prefix
        self.retention_seconds = retention_seconds

    async def store(self, *, ref: AgentNativeTestRef, key: AgentOperationKey, result: JsonValue) -> str:
        if ref != self.ref or key.invocation_id != ref.invocation_id:
            raise NativeContinuationConflict("result owner mismatch")
        payload = json.dumps(
            {"ref": ref.model_dump(mode="json"), "key": key.model_dump(mode="json"), "result": result},
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        if len(payload.encode()) > 2**20:
            raise ValueError("native result exceeds protected payload limit")
        identity = json.dumps(
            [ref.model_dump(mode="json"), key.model_dump(mode="json")], sort_keys=True, separators=(",", ":")
        )
        result_ref = "native-result-" + hashlib.sha256(identity.encode()).hexdigest()
        redis_key = f"{self.prefix}:native-result:{result_ref}"
        if not await self.redis.set(redis_key, payload, nx=True, ex=self.retention_seconds):
            existing = await self.redis.get(redis_key)
            if existing is None or _decode_redis_text(existing) != payload:
                raise NativeContinuationConflict("immutable result conflict")
        return result_ref

    async def load(self, result_ref: str) -> JsonValue:
        raw = await self.redis.get(f"{self.prefix}:native-result:{result_ref}")
        if raw is None:
            raise NativeContinuationConflict("protected result unavailable")
        payload = json.loads(raw)
        if AgentNativeTestRef.model_validate(payload["ref"]) != self.ref:
            raise NativeContinuationConflict("result owner mismatch")
        return payload["result"]
