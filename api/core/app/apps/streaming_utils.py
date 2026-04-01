from __future__ import annotations

import json
import time
from collections.abc import Callable, Generator, Iterable, Mapping
from typing import Any

from core.app.entities.task_entities import StreamEvent
from libs.broadcast_channel.channel import Topic
from libs.broadcast_channel.exc import SubscriptionClosedError


def stream_topic_events(
    *,
    topic: Topic,
    idle_timeout: float,
    ping_interval: float | None = None,
    on_subscribe: Callable[[], None] | None = None,
    terminal_events: Iterable[str | StreamEvent] | None = None,
) -> Generator[Mapping[str, Any] | str, None, None]:
    # send a PING event immediately to prevent the connection staying in pending state for a long time.
    #
    # This simplify the debugging process as the DevTools in Chrome does not
    # provide complete curl command for pending connections.
    yield StreamEvent.PING.value

    terminal_values = _normalize_terminal_events(terminal_events)
    last_msg_time = time.time()
    last_ping_time = last_msg_time
    with topic.subscribe() as sub:
        # on_subscribe fires only after the Redis subscription is active.
        # This is used to gate task start and reduce pub/sub race for the first event.
        if on_subscribe is not None:
            on_subscribe()
        while True:
            try:
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
            yield event
            if not isinstance(event, dict):
                continue

            event_type = event.get("event")
            if event_type in terminal_values:
                return


def _normalize_terminal_events(terminal_events: Iterable[str | StreamEvent] | None) -> set[str]:
    if not terminal_events:
        return {StreamEvent.WORKFLOW_FINISHED.value, StreamEvent.WORKFLOW_PAUSED.value}
    values: set[str] = set()
    for item in terminal_events:
        if isinstance(item, StreamEvent):
            values.add(item.value)
        else:
            values.add(str(item))
    return values
