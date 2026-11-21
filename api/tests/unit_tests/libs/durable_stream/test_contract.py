"""Test-only in-memory adapter used to exercise the backend-independent contract."""

from __future__ import annotations

import threading
import time
from typing import Self, override

from libs.durable_stream import (
    CLOSED,
    Closed,
    CursorUnavailableError,
    DurableStreamProducer,
    DurableStreamRecord,
    DurableStreamSubscription,
    DurableStreamTopic,
    DurableStreamUnavailableError,
    TopicCursor,
)
from tests.unit_tests.libs.durable_stream.contract import DurableStreamContract


class _MemoryTopic(DurableStreamTopic):
    def __init__(self, name: str) -> None:
        self._name = name
        self._records: list[DurableStreamRecord] = []
        self._unavailable_cursors: set[TopicCursor] = set()
        self._sealed = False
        self._fail_next_append = False
        self._condition = threading.Condition()

    @override
    def as_producer(self) -> DurableStreamProducer:
        return self

    @override
    def append(self, payload: bytes) -> None:
        with self._condition:
            if self._fail_next_append:
                self._fail_next_append = False
                raise DurableStreamUnavailableError("injected append failure")
            if self._sealed:
                raise DurableStreamUnavailableError("the topic is sealed")

            position = len(self._records) + 1
            cursor = TopicCursor(f"{self._name}:{position}")
            self._records.append(DurableStreamRecord(payload=payload, cursor=cursor))
            self._condition.notify_all()

    @override
    def subscribe_from_beginning(self) -> DurableStreamSubscription:
        with self._condition:
            boundary = self._records[0].cursor if self._records else None
            return _MemorySubscription(self, next_index=0, boundary_cursor=boundary)

    @override
    def subscribe_from_cursor(self, cursor: TopicCursor) -> DurableStreamSubscription:
        with self._condition:
            position = self._resolve_cursor(cursor)
            if cursor in self._unavailable_cursors:
                raise CursorUnavailableError("the cursor is unavailable")
            return _MemorySubscription(self, next_index=position, boundary_cursor=cursor)

    @override
    def subscribe_from_tail(self) -> DurableStreamSubscription:
        with self._condition:
            boundary = self._records[-1].cursor if self._records else None
            return _MemorySubscription(self, next_index=len(self._records), boundary_cursor=boundary)

    @override
    def seal(self) -> None:
        with self._condition:
            self._sealed = True
            self._condition.notify_all()

    def make_cursor_unavailable(self, cursor: TopicCursor) -> None:
        with self._condition:
            self._resolve_cursor(cursor)
            self._unavailable_cursors.add(cursor)
            self._condition.notify_all()

    def fail_next_append(self) -> None:
        with self._condition:
            self._fail_next_append = True

    def _resolve_cursor(self, cursor: TopicCursor) -> int:
        prefix = f"{self._name}:"
        if not cursor.startswith(prefix):
            raise CursorUnavailableError("the cursor belongs to another topic or is malformed")

        try:
            position = int(cursor.removeprefix(prefix))
        except ValueError as exc:
            raise CursorUnavailableError("the cursor is malformed") from exc
        if position < 1 or position > len(self._records):
            raise CursorUnavailableError("the cursor position is unavailable")
        return position


class _MemorySubscription(DurableStreamSubscription):
    def __init__(
        self,
        topic: _MemoryTopic,
        *,
        next_index: int,
        boundary_cursor: TopicCursor | None,
    ) -> None:
        self._topic = topic
        self._next_index = next_index
        self._boundary_cursor = boundary_cursor
        self._current_cursor = boundary_cursor
        self._entered = False
        self._entered_once = False
        self._closed = False
        self._resource_acquired = False
        self._fail_next_enter = False
        self._fail_next_receive = False

    @override
    def __enter__(self) -> Self:
        with self._topic._condition:
            if self._entered_once or self._closed:
                raise DurableStreamUnavailableError("the subscription cannot be entered again")
            self._entered_once = True
            self._resource_acquired = True
            if self._fail_next_enter:
                self._fail_next_enter = False
                self._resource_acquired = False
                self._closed = True
                raise DurableStreamUnavailableError("injected enter failure")
            if self._boundary_cursor in self._topic._unavailable_cursors:
                self._resource_acquired = False
                self._closed = True
                raise CursorUnavailableError("the starting cursor is unavailable")
            self._entered = True
            return self

    @override
    def close(self) -> None:
        with self._topic._condition:
            self._resource_acquired = False
            self._closed = True
            self._topic._condition.notify_all()

    @override
    def receive(self, timeout: float = 0.1) -> DurableStreamRecord | Closed | None:
        deadline = time.monotonic() + timeout
        with self._topic._condition:
            if self._closed:
                return CLOSED
            if not self._entered:
                raise DurableStreamUnavailableError("the subscription has not been entered")
            if self._fail_next_receive:
                self._fail_next_receive = False
                self._resource_acquired = False
                self._closed = True
                raise DurableStreamUnavailableError("injected receive failure")
            if self._current_cursor in self._topic._unavailable_cursors:
                self._resource_acquired = False
                self._closed = True
                raise CursorUnavailableError("the current cursor is unavailable")

            while self._next_index >= len(self._topic._records):
                if self._closed:
                    return CLOSED
                if self._topic._sealed:
                    self._resource_acquired = False
                    self._closed = True
                    return CLOSED

                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._topic._condition.wait(timeout=remaining)

            record = self._topic._records[self._next_index]
            self._next_index += 1
            self._current_cursor = record.cursor
            return record

    def fail_next_receive(self) -> None:
        with self._topic._condition:
            self._fail_next_receive = True
            self._topic._condition.notify_all()

    def fail_next_enter_after_acquiring_resources(self) -> None:
        with self._topic._condition:
            self._fail_next_enter = True


class TestInMemoryDurableStreamContract(DurableStreamContract):
    @override
    def create_topic(self, name: str) -> DurableStreamTopic:
        return _MemoryTopic(name)

    @override
    def make_cursor_unavailable(self, topic: DurableStreamTopic, cursor: TopicCursor) -> None:
        assert isinstance(topic, _MemoryTopic)
        topic.make_cursor_unavailable(cursor)

    @override
    def fail_next_append(self, topic: DurableStreamTopic) -> None:
        assert isinstance(topic, _MemoryTopic)
        topic.fail_next_append()

    @override
    def fail_next_receive(self, subscription: DurableStreamSubscription) -> None:
        assert isinstance(subscription, _MemorySubscription)
        subscription.fail_next_receive()

    @override
    def fail_next_enter_after_acquiring_resources(self, subscription: DurableStreamSubscription) -> None:
        assert isinstance(subscription, _MemorySubscription)
        subscription.fail_next_enter_after_acquiring_resources()

    @override
    def assert_subscription_resources_released(self, subscription: DurableStreamSubscription) -> None:
        assert isinstance(subscription, _MemorySubscription)
        assert not subscription._resource_acquired
