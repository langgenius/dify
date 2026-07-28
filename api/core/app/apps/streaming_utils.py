from __future__ import annotations

import json
import time
from collections.abc import Callable, Generator, Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, override, runtime_checkable

from core.app.entities.task_entities import StreamEvent
from libs.broadcast_channel.channel import CursorSubscription, Topic
from libs.broadcast_channel.exc import SubscriptionClosedError


@dataclass(frozen=True)
class StreamEventWithCursor:
    """A decoded application event and its durable replay cursor."""

    event: Mapping[str, Any]
    cursor: str


@runtime_checkable
class _Closable(Protocol):
    def close(self) -> None: ...


def close_stream(stream: object) -> None:
    """Close a stream when its concrete iterator exposes the close protocol."""
    if isinstance(stream, _Closable):
        stream.close()


class WorkflowRunIdentifiedStream(Iterator[str]):
    """Streaming response carrying its stable logical workflow-run identifier.

    The workflow run is allocated before the first SSE event.  Keeping it on
    the iterable lets the final HTTP boundary expose ``X-Workflow-Run-ID`` even
    if the socket drops before ``workflow_started`` is delivered.
    """

    def __init__(self, stream: Iterable[str], *, workflow_run_id: str) -> None:
        self._stream = stream
        self._iterator = iter(stream)
        self.workflow_run_id = workflow_run_id

    @override
    def __iter__(self) -> WorkflowRunIdentifiedStream:
        return self

    @override
    def __next__(self) -> str:
        return next(self._iterator)

    def close(self) -> None:
        close_stream(self._stream)


def stream_topic_events(
    *,
    topic: Topic,
    idle_timeout: float,
    ping_interval: float | None = None,
    on_subscribe: Callable[[], None] | None = None,
    terminal_events: Iterable[str | StreamEvent] | None = None,
    cursor: str | None = None,
) -> Generator[Mapping[str, Any] | StreamEventWithCursor | str, None, None]:
    terminal_values = _normalize_terminal_events(terminal_events)
    last_msg_time = time.time()
    last_ping_time = last_msg_time
    subscription = topic.subscribe(cursor=cursor) if cursor is not None else topic.subscribe()
    with subscription as sub:
        # on_subscribe fires only after the Redis subscription is active.
        # This is used to gate task start and reduce pub/sub race for the first event.
        if on_subscribe is not None:
            on_subscribe()

        # Do not expose the first response byte until the subscription is live
        # and task dispatch has succeeded. Otherwise a process can disappear
        # after returning the stable run ID but before creating any recoverable
        # execution for it.
        yield StreamEvent.PING.value
        while True:
            try:
                if isinstance(sub, CursorSubscription):
                    cursor_message = sub.receive_with_cursor(timeout=1)
                    msg = None if cursor_message is None else cursor_message.payload
                else:
                    cursor_message = None
                    msg = sub.receive(timeout=1)
            except SubscriptionClosedError:
                return
            if msg is None:
                current_time = time.time()
                if current_time - last_msg_time > idle_timeout:
                    return
                if ping_interval is not None and current_time - last_ping_time >= ping_interval:
                    yield StreamEvent.PING.value
                    last_ping_time = current_time
                continue

            last_msg_time = time.time()
            last_ping_time = last_msg_time
            event = json.loads(msg)
            if cursor_message is not None and isinstance(event, Mapping):
                yield StreamEventWithCursor(event=event, cursor=cursor_message.cursor)
            else:
                yield event
            if not isinstance(event, dict):
                continue

            event_type = event.get("event")
            if event_type in terminal_values:
                return


def _normalize_terminal_events(terminal_events: Iterable[str | StreamEvent] | None) -> set[str]:
    if terminal_events is None:
        return {StreamEvent.WORKFLOW_FINISHED.value, StreamEvent.WORKFLOW_PAUSED.value}
    values: set[str] = set()
    for item in terminal_events:
        if isinstance(item, StreamEvent):
            values.add(item.value)
        else:
            values.add(str(item))
    return values
