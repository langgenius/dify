from collections.abc import Iterable

from graphon.engine.filter.protocol import (
    EngineEventFilter,
    EngineEventFilterContext,
)
from graphon.engine_events.base import EngineEvent


def filter_engine_events(
    events: Iterable[EngineEvent],
    *,
    context: EngineEventFilterContext,
    filters: Iterable[EngineEventFilter],
) -> Iterable[EngineEvent]:
    """Apply engine event filters in registration order."""
    filter_list = list(filters)
    for event_filter in filter_list:
        event_filter.initialize(context)

    for event in events:
        yield from _apply_filters(
            event,
            filters=filter_list,
            start_index=0,
        )

    for index, event_filter in enumerate(filter_list):
        for event in event_filter.flush():
            yield from _apply_filters(
                event,
                filters=filter_list,
                start_index=index + 1,
            )


def _apply_filters(
    event: EngineEvent,
    *,
    filters: list[EngineEventFilter],
    start_index: int,
) -> Iterable[EngineEvent]:
    pending_events = [event]
    for event_filter in filters[start_index:]:
        next_events: list[EngineEvent] = []
        for pending_event in pending_events:
            next_events.extend(event_filter.on_event(pending_event))
        pending_events = next_events
        if not pending_events:
            break
    yield from pending_events
