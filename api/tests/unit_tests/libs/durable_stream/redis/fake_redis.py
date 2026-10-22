from __future__ import annotations

import threading
import time
from collections.abc import Mapping

from redis.exceptions import ConnectionError, ResponseError

from libs.durable_stream.redis.stream import _APPEND_SCRIPT, _RESOLVE_BOUNDARY_SCRIPT, _SEAL_SCRIPT


class FakeRedisDurableStream:
    """Minimal thread-safe Redis Streams double for adapter contract tests."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._store: dict[str, list[tuple[bytes, dict[bytes, bytes]]]] = {}
        self._next_id: dict[str, int] = {}
        self.expirations: dict[str, int] = {}
        self.fail_next_eval = False
        self.fail_next_xrange = False
        self.fail_next_xrevrange = False
        self.fail_next_xread = False

    def execute_command(self, *command_args: object, **options: object) -> object:
        del options
        assert len(command_args) >= 4
        assert self._as_text_value(command_args[0]) == "EVAL"
        script = self._as_text_value(command_args[1])
        numkeys = self._as_int(command_args[2])
        args = command_args[3:]
        assert numkeys == 1
        key = self._as_text_value(args[0])
        with self._condition:
            if self.fail_next_eval:
                self.fail_next_eval = False
                raise ConnectionError("injected eval failure")
            if script == _APPEND_SCRIPT:
                assert isinstance(args[1], bytes)
                return self._append(
                    key,
                    payload=args[1],
                    max_length=self._as_int(args[2]),
                    retention=self._as_int(args[3]),
                )
            if script == _SEAL_SCRIPT:
                return self._seal(
                    key,
                    max_length=self._as_int(args[1]),
                    retention=self._as_int(args[2]),
                )
            if script == _RESOLVE_BOUNDARY_SCRIPT:
                return self._resolve_boundary(
                    key,
                    mode=self._as_text_value(args[1]),
                    max_length=self._as_int(args[2]),
                    retention=self._as_int(args[3]),
                )
        raise AssertionError("unexpected Redis script")

    def xrange(
        self,
        key: str,
        min: str = "-",
        max: str = "+",
        count: int | None = None,
    ) -> list[tuple[bytes, dict[bytes, bytes]]]:
        with self._condition:
            if self.fail_next_xrange:
                self.fail_next_xrange = False
                raise ConnectionError("injected xrange failure")
            entries = list(self._store.get(key, []))
            if min != "-" or max != "+":
                entries = [entry for entry in entries if self._in_range(entry[0], min, max)]
            return entries if count is None else entries[:count]

    def xrevrange(
        self,
        key: str,
        max: str = "+",
        min: str = "-",
        count: int | None = None,
    ) -> list[tuple[bytes, dict[bytes, bytes]]]:
        del max, min
        with self._condition:
            if self.fail_next_xrevrange:
                self.fail_next_xrevrange = False
                raise ConnectionError("injected xrevrange failure")
            entries = list(reversed(self._store.get(key, [])))
            return entries if count is None else entries[:count]

    def xread(
        self,
        streams: Mapping[str, str],
        count: int | None = None,
        block: int | None = None,
    ) -> list[tuple[str, list[tuple[bytes, dict[bytes, bytes]]]]]:
        assert len(streams) == 1
        key, last_id = next(iter(streams.items()))
        deadline = None if block is None else time.monotonic() + block / 1000

        with self._condition:
            if self.fail_next_xread:
                self.fail_next_xread = False
                raise ConnectionError("injected xread failure")
            while True:
                entries = [
                    entry for entry in self._store.get(key, []) if self._id_tuple(entry[0]) > self._id_tuple(last_id)
                ]
                if entries:
                    if count is not None:
                        entries = entries[:count]
                    return [(key, entries)]
                if deadline is None:
                    return []
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return []
                self._condition.wait(timeout=remaining)

    def delete_entry(self, key: str, entry_id: str) -> None:
        with self._condition:
            self._store[key] = [entry for entry in self._store.get(key, []) if self._as_text(entry[0]) != entry_id]
            self._condition.notify_all()

    def entries(self, key: str) -> list[tuple[bytes, dict[bytes, bytes]]]:
        with self._condition:
            return list(self._store.get(key, []))

    def _append(self, key: str, *, payload: bytes, max_length: int, retention: int) -> bytes:
        entries = self._store.get(key, [])
        if entries and entries[-1][1].get(b"kind") == b"seal":
            raise ResponseError("DURABLE_STREAM_SEALED")
        return self._add(key, {b"kind": b"data", b"data": payload}, max_length=max_length, retention=retention)

    def _seal(self, key: str, *, max_length: int, retention: int) -> bytes:
        entries = self._store.get(key, [])
        if entries and entries[-1][1].get(b"kind") == b"seal":
            return entries[-1][0]
        return self._add(key, {b"kind": b"seal"}, max_length=max_length, retention=retention)

    def _resolve_boundary(self, key: str, *, mode: str, max_length: int, retention: int) -> list[bytes]:
        entries = self._store.get(key, [])
        if entries:
            entry = entries[0] if mode == "beginning" else entries[-1]
            return [entry[0], entry[1][b"kind"]]
        entry_id = self._add(key, {b"kind": b"boundary"}, max_length=max_length, retention=retention)
        return [entry_id, b"boundary"]

    def _add(self, key: str, fields: dict[bytes, bytes], *, max_length: int, retention: int) -> bytes:
        next_id = self._next_id.get(key, 0) + 1
        self._next_id[key] = next_id
        entry_id = f"{next_id}-0".encode()
        entries = self._store.setdefault(key, [])
        entries.append((entry_id, fields))
        if max_length > 0 and len(entries) > max_length:
            del entries[: len(entries) - max_length]
        if retention > 0:
            self.expirations[key] = retention
        self._condition.notify_all()
        return entry_id

    @classmethod
    def _in_range(cls, entry_id: bytes, minimum: str, maximum: str) -> bool:
        value = cls._id_tuple(entry_id)
        return (minimum == "-" or value >= cls._id_tuple(minimum)) and (
            maximum == "+" or value <= cls._id_tuple(maximum)
        )

    @staticmethod
    def _id_tuple(entry_id: bytes | str) -> tuple[int, int]:
        milliseconds, sequence = FakeRedisDurableStream._as_text(entry_id).split("-", 1)
        return int(milliseconds), int(sequence)

    @staticmethod
    def _as_text(value: bytes | str) -> str:
        return value.decode() if isinstance(value, bytes) else value

    @staticmethod
    def _as_text_value(value: object) -> str:
        assert isinstance(value, (bytes, str))
        return FakeRedisDurableStream._as_text(value)

    @staticmethod
    def _as_int(value: object) -> int:
        assert isinstance(value, (bytes, str, int))
        return int(value)
