from __future__ import annotations

import hashlib
import re
import time
from collections.abc import Mapping, Sequence
from typing import Final, Self, override

from redis import Redis, RedisCluster
from redis.exceptions import RedisError

from extensions.redis_names import serialize_redis_name
from libs.durable_stream.exc import CursorUnavailableError, DurableStreamUnavailableError
from libs.durable_stream.stream import (
    CLOSED,
    Closed,
    DurableStreamProducer,
    DurableStreamRecord,
    DurableStreamSubscription,
    DurableStreamTopic,
    TopicCursor,
)

_CURSOR_VERSION: Final = "v1"
_STREAM_ID_PATTERN: Final = re.compile(r"^[0-9]+-[0-9]+$")
_INITIAL_STREAM_ID: Final = "0-0"
_KIND_FIELD: Final = b"kind"
_PAYLOAD_FIELD: Final = b"data"
_DATA_KIND: Final = b"data"
_BOUNDARY_KIND: Final = b"boundary"
_SEAL_KIND: Final = b"seal"

_APPEND_SCRIPT: Final = """
local tail = redis.call("XREVRANGE", KEYS[1], "+", "-", "COUNT", 1)
if #tail > 0 then
    local fields = tail[1][2]
    for index = 1, #fields, 2 do
        if fields[index] == "kind" and fields[index + 1] == "seal" then
            return redis.error_reply("DURABLE_STREAM_SEALED")
        end
    end
end

local id
if tonumber(ARGV[2]) > 0 then
    id = redis.call("XADD", KEYS[1], "MAXLEN", "~", ARGV[2], "*", "kind", "data", "data", ARGV[1])
else
    id = redis.call("XADD", KEYS[1], "*", "kind", "data", "data", ARGV[1])
end

if tonumber(ARGV[3]) > 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[3])
end
return id
"""

_SEAL_SCRIPT: Final = """
local tail = redis.call("XREVRANGE", KEYS[1], "+", "-", "COUNT", 1)
if #tail > 0 then
    local fields = tail[1][2]
    for index = 1, #fields, 2 do
        if fields[index] == "kind" and fields[index + 1] == "seal" then
            return tail[1][1]
        end
    end
end

local id
if tonumber(ARGV[1]) > 0 then
    id = redis.call("XADD", KEYS[1], "MAXLEN", "~", ARGV[1], "*", "kind", "seal")
else
    id = redis.call("XADD", KEYS[1], "*", "kind", "seal")
end

if tonumber(ARGV[2]) > 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return id
"""

_RESOLVE_BOUNDARY_SCRIPT: Final = """
local entries
if ARGV[1] == "beginning" then
    entries = redis.call("XRANGE", KEYS[1], "-", "+", "COUNT", 1)
else
    entries = redis.call("XREVRANGE", KEYS[1], "+", "-", "COUNT", 1)
end

if #entries > 0 then
    local fields = entries[1][2]
    for index = 1, #fields, 2 do
        if fields[index] == "kind" then
            return {entries[1][1], fields[index + 1]}
        end
    end
    return redis.error_reply("DURABLE_STREAM_INVALID_ENTRY")
end

local id
if tonumber(ARGV[2]) > 0 then
    id = redis.call("XADD", KEYS[1], "MAXLEN", "~", ARGV[2], "*", "kind", "boundary")
else
    id = redis.call("XADD", KEYS[1], "*", "kind", "boundary")
end

if tonumber(ARGV[3]) > 0 then
    redis.call("EXPIRE", KEYS[1], ARGV[3])
end
return {id, "boundary"}
"""

type RedisClient = Redis[bytes] | RedisCluster
type RedisFields = Mapping[bytes | str, object]
type RedisEntry = tuple[object, RedisFields]


class RedisDurableStreamTopic(DurableStreamTopic):
    """Redis Streams adapter for one durable stream topic.

    The injected client must preserve response bytes because payloads are opaque.
    """

    def __init__(
        self,
        redis_client: RedisClient,
        name: str,
        *,
        retention_seconds: int = 600,
        max_length: int = 5000,
    ) -> None:
        self._client = redis_client
        self._name = name
        self._key = serialize_redis_name(f"durable_stream:{name}")
        self._cursor_topic = hashlib.sha256(self._key.encode()).hexdigest()
        self._retention_seconds = max(int(retention_seconds), 0)
        self._max_length = max(int(max_length), 0)

    @override
    def as_producer(self) -> DurableStreamProducer:
        return self

    @override
    def append(self, payload: bytes) -> None:
        try:
            self._client.execute_command(
                "EVAL",
                _APPEND_SCRIPT,
                1,
                self._key,
                payload,
                self._max_length,
                self._retention_seconds,
            )
        except RedisError as exc:
            raise DurableStreamUnavailableError("failed to append to the Redis durable stream") from exc

    @override
    def subscribe_from_beginning(self) -> DurableStreamSubscription:
        entry_id, kind = self._resolve_boundary("beginning")
        if kind == _SEAL_KIND:
            return self._new_subscription(start_id=_INITIAL_STREAM_ID, closed_at_creation=True)
        if kind == _BOUNDARY_KIND:
            return self._new_subscription(start_id=entry_id, boundary_id=entry_id)
        return self._new_subscription(
            start_id=_INITIAL_STREAM_ID,
            boundary_id=entry_id,
        )

    @override
    def subscribe_from_cursor(self, cursor: TopicCursor) -> DurableStreamSubscription:
        entry_id = self._decode_cursor(cursor)
        self._assert_cursor_available(cursor)
        return self._new_subscription(start_id=entry_id, boundary_id=entry_id)

    @override
    def subscribe_from_tail(self) -> DurableStreamSubscription:
        entry_id, kind = self._resolve_boundary("tail")
        if kind == _SEAL_KIND:
            return self._new_subscription(start_id=entry_id, closed_at_creation=True)
        return self._new_subscription(start_id=entry_id, boundary_id=entry_id)

    @override
    def seal(self) -> None:
        try:
            self._client.execute_command(
                "EVAL",
                _SEAL_SCRIPT,
                1,
                self._key,
                self._max_length,
                self._retention_seconds,
            )
        except RedisError as exc:
            raise DurableStreamUnavailableError("failed to seal the Redis durable stream") from exc

    def _new_subscription(
        self,
        *,
        start_id: str,
        boundary_id: str | None = None,
        closed_at_creation: bool = False,
    ) -> _RedisDurableStreamSubscription:
        return _RedisDurableStreamSubscription(
            self,
            start_id=start_id,
            boundary_id=boundary_id,
            closed_at_creation=closed_at_creation,
        )

    def _encode_cursor(self, entry_id: str) -> TopicCursor:
        return TopicCursor(f"{_CURSOR_VERSION}.{self._cursor_topic}.{entry_id}")

    def _decode_cursor(self, cursor: TopicCursor) -> str:
        try:
            version, cursor_topic, entry_id = cursor.split(".", 2)
        except ValueError as exc:
            raise CursorUnavailableError("the cursor is malformed") from exc
        if version != _CURSOR_VERSION or cursor_topic != self._cursor_topic:
            raise CursorUnavailableError("the cursor belongs to another topic or adapter version")
        if _STREAM_ID_PATTERN.fullmatch(entry_id) is None:
            raise CursorUnavailableError("the cursor contains an invalid Redis Stream ID")
        return entry_id

    def _assert_cursor_available(self, cursor: TopicCursor) -> None:
        entry_id = self._decode_cursor(cursor)
        entry = self._assert_entry_available(entry_id)
        _, kind, _ = self._parse_entry(entry)
        if kind != _DATA_KIND:
            raise CursorUnavailableError("the cursor does not identify a durable stream record")

    def _assert_entry_available(self, entry_id: str) -> RedisEntry:
        entry = self._get_entry(entry_id)
        if entry is None:
            raise CursorUnavailableError("the cursor is no longer retained")
        self._parse_entry(entry)
        return entry

    def _probe_subscription(self, boundary_id: str | None) -> None:
        if boundary_id is not None:
            self._assert_entry_available(boundary_id)
            return
        self._get_last_entry()

    def _resolve_boundary(self, mode: str) -> tuple[str, bytes]:
        try:
            result = self._client.execute_command(
                "EVAL",
                _RESOLVE_BOUNDARY_SCRIPT,
                1,
                self._key,
                mode,
                self._max_length,
                self._retention_seconds,
            )
        except RedisError as exc:
            raise DurableStreamUnavailableError("failed to resolve the Redis stream boundary") from exc
        if not isinstance(result, (list, tuple)) or len(result) != 2:
            raise DurableStreamUnavailableError("Redis returned an invalid durable stream boundary")
        entry_id = self._decode_text(result[0], "boundary stream ID")
        kind = self._decode_bytes(result[1], "boundary record kind")
        if _STREAM_ID_PATTERN.fullmatch(entry_id) is None or kind not in {_DATA_KIND, _BOUNDARY_KIND, _SEAL_KIND}:
            raise DurableStreamUnavailableError("Redis returned an invalid durable stream boundary")
        return entry_id, kind

    def _get_last_entry(self) -> RedisEntry | None:
        try:
            entries = self._client.xrevrange(self._key, max="+", min="-", count=1)
        except RedisError as exc:
            raise DurableStreamUnavailableError("failed to resolve the Redis stream tail") from exc
        return self._single_entry(entries)

    def _get_entry(self, entry_id: str) -> RedisEntry | None:
        try:
            entries = self._client.xrange(self._key, min=entry_id, max=entry_id, count=1)
        except RedisError as exc:
            raise DurableStreamUnavailableError("failed to validate a Redis stream cursor") from exc
        return self._single_entry(entries)

    def _read_after(self, entry_id: str, *, block_milliseconds: int | None) -> RedisEntry | None:
        try:
            streams = self._client.xread(
                {self._key: entry_id},
                count=1,
                block=block_milliseconds,
            )
        except RedisError as exc:
            raise DurableStreamUnavailableError("failed to receive from the Redis durable stream") from exc
        if not streams:
            return None
        _, entries = streams[0]
        return self._single_entry(entries)

    @staticmethod
    def _single_entry(entries: Sequence[object]) -> RedisEntry | None:
        if not entries:
            return None
        entry = entries[0]
        if not isinstance(entry, (list, tuple)) or len(entry) != 2 or not isinstance(entry[1], Mapping):
            raise DurableStreamUnavailableError("Redis returned an invalid durable stream entry")
        return entry[0], entry[1]

    @staticmethod
    def _parse_entry(entry: RedisEntry) -> tuple[str, bytes, bytes | None]:
        raw_id, fields = entry
        entry_id = RedisDurableStreamTopic._decode_text(raw_id, "stream ID")
        if _STREAM_ID_PATTERN.fullmatch(entry_id) is None:
            raise DurableStreamUnavailableError("Redis returned an invalid stream ID")

        raw_kind = fields.get(_KIND_FIELD, fields.get("kind"))
        kind = RedisDurableStreamTopic._decode_bytes(raw_kind, "record kind")
        if kind == _SEAL_KIND:
            return entry_id, kind, None
        if kind == _BOUNDARY_KIND:
            return entry_id, kind, None
        if kind != _DATA_KIND:
            raise DurableStreamUnavailableError("Redis returned an unknown durable stream record kind")

        raw_payload = fields.get(_PAYLOAD_FIELD, fields.get("data"))
        payload = RedisDurableStreamTopic._decode_bytes(raw_payload, "record payload")
        return entry_id, kind, payload

    @staticmethod
    def _decode_text(value: object, field: str) -> str:
        if isinstance(value, str):
            return value
        if isinstance(value, bytes):
            try:
                return value.decode("ascii")
            except UnicodeDecodeError as exc:
                raise DurableStreamUnavailableError(f"Redis returned a non-ASCII {field}") from exc
        raise DurableStreamUnavailableError(f"Redis returned an invalid {field}")

    @staticmethod
    def _decode_bytes(value: object, field: str) -> bytes:
        if isinstance(value, bytes):
            return value
        if isinstance(value, bytearray):
            return bytes(value)
        if isinstance(value, str):
            return value.encode()
        raise DurableStreamUnavailableError(f"Redis returned an invalid {field}")


class _RedisDurableStreamSubscription(DurableStreamSubscription):
    def __init__(
        self,
        topic: RedisDurableStreamTopic,
        *,
        start_id: str,
        boundary_id: str | None,
        closed_at_creation: bool,
    ) -> None:
        self._topic = topic
        self._last_id = start_id
        self._boundary_id = boundary_id
        self._validation_id = boundary_id
        self._closed_at_creation = closed_at_creation
        self._entered = False
        self._entered_once = False
        self._closed = False

    @override
    def __enter__(self) -> Self:
        if self._entered_once or self._closed:
            raise DurableStreamUnavailableError("the subscription cannot be entered again")
        self._entered_once = True

        try:
            self._topic._probe_subscription(self._boundary_id)
        except (CursorUnavailableError, DurableStreamUnavailableError):
            self._mark_closed()
            raise

        self._entered = True
        return self

    @override
    def close(self) -> None:
        self._mark_closed()

    @override
    def receive(self, timeout: float = 0.1) -> DurableStreamRecord | Closed | None:
        return self._receive(timeout)

    def _receive(self, timeout: float) -> DurableStreamRecord | Closed | None:
        deadline = time.monotonic() + max(float(timeout), 0.0)
        first_attempt = True

        while True:
            if self._closed:
                return CLOSED
            if not self._entered:
                raise DurableStreamUnavailableError("the subscription has not been entered")
            if self._closed_at_creation:
                self._mark_closed()
                return CLOSED
            validation_id = self._validation_id
            last_id = self._last_id

            remaining = deadline - time.monotonic()
            if not first_attempt and remaining <= 0:
                return None
            first_attempt = False
            block_milliseconds = None
            if remaining > 0:
                block_milliseconds = max(1, int(remaining * 1000))

            try:
                if validation_id is not None:
                    self._topic._assert_entry_available(validation_id)
                entry = self._topic._read_after(last_id, block_milliseconds=block_milliseconds)
                if entry is not None and validation_id is not None:
                    self._topic._assert_entry_available(validation_id)
            except (CursorUnavailableError, DurableStreamUnavailableError):
                self._mark_closed()
                raise

            if entry is None:
                continue

            entry_id, kind, payload = self._topic._parse_entry(entry)
            if kind == _SEAL_KIND:
                self._mark_closed()
                return CLOSED
            if kind == _BOUNDARY_KIND:
                self._last_id = entry_id
                self._validation_id = entry_id
                continue
            assert payload is not None
            cursor = self._topic._encode_cursor(entry_id)
            self._last_id = entry_id
            self._validation_id = entry_id
            return DurableStreamRecord(payload=payload, cursor=cursor)

    def _mark_closed(self) -> None:
        self._closed = True
        self._entered = False
