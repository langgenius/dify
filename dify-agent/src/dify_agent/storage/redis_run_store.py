"""Redis-backed run admission, records, event streams, and cancellation intents.

The store writes run metadata as JSON strings and events as Redis streams.
HTTP event cursors are Redis stream ids; ``0-0`` means replay from the beginning
for polling and SSE. Records, event streams, and intents share one retention
window that is refreshed when status or event data is written. Execution is scheduled
in-process by ``dify_agent.runtime.run_scheduler``; Redis is not a job queue, and
create-run payloads are never persisted because layer config may include
sensitive runtime configuration. Admission stores only key/request digests and
run ids. Active writes refresh an unowned or same-run claim; passive replays
never extend retention. Multi-key Lua coordination requires non-Cluster Redis.
"""

import hashlib
import json
from collections.abc import AsyncIterator, Awaitable
from typing import cast, override

from pydantic import JsonValue
from redis.asyncio import Redis

from dify_agent.protocol.native_testing import (
    AgentNativeTestRef,
    AgentOperationKey,
    AgentRuntimeIdentity,
    AgentRuntimeIdentitySeed,
)
from dify_agent.protocol.schemas import (
    RUN_EVENT_ADAPTER,
    AgentRunUsage,
    CancelRunRequest,
    RunCancelledEvent,
    RunCancelledEventData,
    RunEvent,
    RunEventsResponse,
    RunStatus,
    utc_now,
)
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.event_sink import (
    NonTerminalRunEvent,
    RunEventSink,
    RunFinalizationResult,
    RunStreamSealedError,
    TerminalRunEvent,
    terminal_event_status_fields,
)
from dify_agent.runtime.native_continuation import NativeContinuationConflict
from dify_agent.server.schemas import RunRecord, new_run_id
from dify_agent.server.settings import DEFAULT_RUN_EVENT_STREAM_MAX_LENGTH, DEFAULT_RUN_RETENTION_SECONDS
from dify_agent.storage.redis_keys import (
    run_cancel_intent_key,
    run_events_key,
    run_idempotency_key,
    run_record_key,
)

_TERMINAL_RUN_EVENT_TYPES = {"run_succeeded", "run_failed", "run_cancelled"}


_REFRESH_IDEMPOTENCY_CLAIM = """
-- Legacy/unkeyed records omit the digest or decode it as cjson.null.
if type(record.idempotency_key_digest) == "string" then
    local prefix = string.sub(KEYS[1], 1, #KEYS[1] - #(":runs:" .. record.run_id .. ":record"))
    local claim_key = prefix .. ":idempotency:" .. record.idempotency_key_digest
    local owner = redis.call("GET", claim_key)
    -- An expired claim may already belong to a newer run; never overwrite it.
    if not owner or owner == record.run_id then
        redis.call("SET", claim_key, record.run_id, "EX", ttl)
    end
end
"""


_CREATE_RUN_IDEMPOTENT_SCRIPT = """
-- KEYS: claim, candidate record. ARGV: run id, fingerprint, record JSON, TTL, prefix.
-- Return {1, ""} on creation, {0, record JSON} on replay, {-1, ""} on conflict.
local existing_run_id = redis.call("GET", KEYS[1])
if existing_run_id then
    local existing_record_key = ARGV[5] .. ":runs:" .. existing_run_id .. ":record"
    local existing_record = redis.call("GET", existing_record_key)
    if existing_record then
        if cjson.decode(existing_record).idempotency_fingerprint ~= ARGV[2] then
            return {-1, ""}
        end
        -- Reading a retained run does not extend its record or claim TTL.
        return {0, existing_record}
    end
end

redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[4])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[4])
return {1, ""}
"""


class IdempotencyConflictError(RuntimeError):
    """Raised when a key is reused with a different create-run request."""


class RunNotFoundError(LookupError):
    """Raised when a requested run record does not exist."""


_FINALIZE_RUN_SCRIPT = (
    """
-- KEYS: record, events, cancel intent. ARGV: status, updated time, error flag/text,
-- error-type flag/text, event JSON, TTL, max stream length.
-- Return {code, status, event id}: -1 missing, -2 cancellation won, 0 sealed, 1 applied.
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
"""
    + _REFRESH_IDEMPOTENCY_CLAIM
    + """
return {1, ARGV[1], event_id}
"""
)


_APPEND_EVENT_SCRIPT = (
    """
-- KEYS: record, events, cancel intent. ARGV: event JSON, max stream length, TTL.
-- Return {-1, ""} if missing, {0, status} if sealed, {1, "running", event id} if appended.
local record_json = redis.call("GET", KEYS[1])
if not record_json then
    return {-1, ""}
end

local record = cjson.decode(record_json)
if record.status ~= "running" then
    return {0, tostring(record.status)}
end

local ttl = tonumber(ARGV[3])
local event_id = redis.call("XADD", KEYS[2], "MAXLEN", "~", ARGV[2], "*", "payload", ARGV[1])
redis.call("EXPIRE", KEYS[2], ttl)
redis.call("EXPIRE", KEYS[1], ttl)
redis.call("EXPIRE", KEYS[3], ttl)
"""
    + _REFRESH_IDEMPOTENCY_CLAIM
    + """
return {1, "running", event_id}
"""
)


_REQUEST_CANCELLATION_SCRIPT = (
    """
-- KEYS: record, cancel intent, events. ARGV: intent JSON, TTL.
-- Return {code, status}: -1 missing, 0 success/failure won, 1 accepted/already cancelled.
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
"""
    + _REFRESH_IDEMPOTENCY_CLAIM
    + """
return {1, "running"}
"""
)


_FINALIZE_CANCELLATION_SCRIPT = (
    """
-- KEYS: record, cancel intent, events. ARGV: updated time, error flag/text,
-- event JSON, TTL, max stream length.
-- Return {code, status, event id}: -1 missing, -2 no intent, 0 sealed, 1 applied.
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
record.native_wait_event_id = cjson.null
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
"""
    + _REFRESH_IDEMPOTENCY_CLAIM
    + """
return {1, "cancelled", event_id}
"""
)


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
r.native_wait_event_id = event_id
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
r.native_wait_event_id = cjson.null
r.native_claim = cjson.null
redis.call("XADD", KEYS[2], "MAXLEN", "~", ARGV[6], "*", "payload", ARGV[4])
redis.call("EXPIRE", KEYS[2], ARGV[5])
redis.call("SET", KEYS[1], cjson.encode(r), "EX", ARGV[5])
return 1
"""


_READ_NATIVE_CHECKPOINT_SCRIPT = """
if redis.call("EXISTS", KEYS[1]) == 0 then return {-1, "", "", ""} end
if redis.call("STRLEN", KEYS[1]) > tonumber(ARGV[3]) then return {-2, "", "", ""} end
local raw = redis.call("GET", KEYS[1])
local ok, r = pcall(cjson.decode, raw)
if not ok or type(r) ~= "table" then return {-2, "", "", ""} end
if r.status ~= "waiting" or redis.call("EXISTS", KEYS[3]) == 1 or
    r.native_dispatch_started == true or (r.native_generation or 0) ~= tonumber(ARGV[1]) or
    r.native_wait_event_id ~= ARGV[2] or type(r.native_checkpoint_json) ~= "string" or
    #r.native_checkpoint_json > tonumber(ARGV[4]) then return {-2, "", "", ""} end
local entries = redis.call("XRANGE", KEYS[2], ARGV[2], ARGV[2], "COUNT", 1)
if #entries ~= 1 or entries[1][1] ~= ARGV[2] then return {-2, "", "", ""} end
local fields = entries[1][2]
if #fields ~= 2 or fields[1] ~= "payload" or #fields[2] > tonumber(ARGV[5]) then return {-2, "", "", ""} end
return {1, raw, entries[1][1], fields[2]}
"""


class RedisRunStore(RunEventSink):
    """Async Redis implementation for run records, event logs, and cancellation intents.

    ``run_retention_seconds`` is shared by the run record key, per-run event
    stream, and pending cancellation intent. Every public event stream write
    applies an approximate maximum length before refreshing the stream and
    record TTLs, so active runs cannot grow one Redis key without bound without
    paying the CPU cost of exact per-entry trimming. The transaction also
    ensures a newly created stream is not left without expiration if the
    client is interrupted between commands.
    Event writes refresh the record TTL so long-running runs that keep producing
    events do not lose their status record mid-run. Non-terminal event appends
    while the run is ``running`` also atomically refresh any existing pending
    cancellation intent's TTL without creating one when absent. Rejected appends
    after a terminal transition do not refresh retention. Active writes also
    refresh the admission claim when it is absent or still owned by that run.
    A newer owner is preserved, and passive admission replays do not refresh any TTL.
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

    async def create_run(self, *, identity: AgentRuntimeIdentitySeed | None = None) -> RunRecord:
        """Persist status and immutable private identity in the same SET, never config."""
        run_id = new_run_id()
        record = RunRecord(
            run_id=run_id,
            status="running",
            runtime_identity=(
                AgentRuntimeIdentity(run_id=run_id, agent_generation=0, **identity.model_dump())
                if identity is not None
                else None
            ),
        )
        await self.redis.set(
            run_record_key(self.prefix, run_id),
            record.model_dump_json(),
            ex=self.run_retention_seconds,
        )
        return record

    async def create_run_idempotent(self, *, idempotency_key: str, request_fingerprint: str) -> tuple[RunRecord, bool]:
        """Atomically claim a key and persist its run, returning ``(record, created)``.

        The Lua script serializes admission across Redis clients, so concurrent
        requests cannot both schedule work. A live matching record is returned
        with its current status without refreshing TTLs; a fingerprint mismatch
        raises ``IdempotencyConflictError``. Missing claims or expired records
        allow a new run. Only digests and a run id are stored for admission.
        """
        key_digest = hashlib.sha256(idempotency_key.encode()).hexdigest()
        record = RunRecord(
            run_id=new_run_id(),
            status="running",
            idempotency_key_digest=key_digest,
            idempotency_fingerprint=request_fingerprint,
        )
        claim_key = run_idempotency_key(self.prefix, key_digest)
        raw_result = await cast(
            Awaitable[object],
            self.redis.eval(
                _CREATE_RUN_IDEMPOTENT_SCRIPT,
                2,
                claim_key,
                run_record_key(self.prefix, record.run_id),
                record.run_id,
                request_fingerprint,
                record.model_dump_json(),
                str(self.run_retention_seconds),
                self.prefix,
            ),
        )
        result = cast(list[object], raw_result)
        status = int(cast(int | bytes | str, result[0]))
        if status == -1:
            raise IdempotencyConflictError("idempotency key was already used with a different create-run request")
        if status == 1:
            return record, True
        return RunRecord.model_validate_json(_decode_redis_text(result[1])), False

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
        """Append a non-terminal event while the durable run status is still ``running``.

        The status check and the write share one linearization point with
        ``finalize_run``/``finalize_cancellation``. An append also keeps an
        existing cancellation intent on the same retention window as the run.
        Once a terminal transition wins, late non-terminal appends are
        rejected without consuming a cursor or refreshing retention.
        """
        payload = RUN_EVENT_ADAPTER.dump_json(event, exclude={"id"}).decode()
        evaluation = cast(
            Awaitable[object],
            self.redis.eval(
                _APPEND_EVENT_SCRIPT,
                3,
                run_record_key(self.prefix, event.run_id),
                run_events_key(self.prefix, event.run_id),
                run_cancel_intent_key(self.prefix, event.run_id),
                payload,
                str(self.run_event_stream_max_length),
                str(self.run_retention_seconds),
            ),
        )
        result = cast(list[object], await evaluation)
        applied = int(cast(int | bytes | str, result[0]))
        if applied == -1:
            raise RunNotFoundError(event.run_id)
        if applied == 0:
            raise RunStreamSealedError(event.run_id, cast(RunStatus, _decode_redis_text(result[1])))
        return _decode_redis_text(result[2])

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
        """Read a nonblocking page strictly after ``after`` using Redis 6.0-compatible XREAD.

        An empty page preserves the supplied cursor; a missing run raises
        ``RunNotFoundError``.
        """
        await self.get_run(run_id)
        response = await self.redis.xread(
            {run_events_key(self.prefix, run_id): after},
            count=limit,
        )
        events = [
            self._decode_event(run_id, raw_id, fields)
            for _stream_name, entries in response
            for raw_id, fields in entries
        ]
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
    "IdempotencyConflictError",
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


_READ_RUN_IDENTITY_SCRIPT = """
local raw = redis.call("GET", KEYS[1])
if not raw then return {-1, "", 0} end
local ok, r = pcall(cjson.decode, raw)
if not ok or type(r.runtime_identity) ~= "table" or type(r.native_generation) ~= "number" then
    return {-2, "", 0}
end
local identity = cjson.encode(r.runtime_identity)
if #identity > tonumber(ARGV[1]) then return {-2, "", 0} end
return {1, identity, r.native_generation}
"""


_READ_ACTIVE_STUB_SCRIPT = """
if redis.call("EXISTS", KEYS[2]) == 1 or redis.call("STRLEN", KEYS[1]) > tonumber(ARGV[5]) then return false end
local raw = redis.call("GET", KEYS[1])
if not raw then return false end
local ok, r = pcall(cjson.decode, raw)
if not ok or type(r) ~= "table" or r.status ~= "running" or r.run_id ~= ARGV[1] then return false end
local i = r.runtime_identity
if type(i) ~= "table" then return false end
if i.execution_mode == "ordinary" then
    if i.parent_node ~= cjson.null then return false end
elseif i.execution_mode == "builder_test" then
    if i.native_test_profile ~= "confirmed" or type(i.parent_node) ~= "table" then return false end
else return false end
if i.run_id ~= ARGV[1] or i.request_digest ~= ARGV[2] or r.native_generation ~= tonumber(ARGV[3]) then return false end
i.agent_generation = r.native_generation
local result = cjson.encode(i)
if #result > tonumber(ARGV[4]) then return false end
return result
"""
