import pytest

from events import Events, EventsError, EventsException


def test_events_package_exposes_opensearchpy_compatible_events_class():
    calls: list[str] = []
    events = Events()

    events.request_start += lambda: calls.append("start")
    events.request_end += lambda: calls.append("end")

    events.request_start()
    events.request_end()

    assert calls == ["start", "end"]


def test_events_package_supports_named_slots_iteration_removal_and_private_attrs():
    calls: list[str] = []

    def handler() -> None:
        calls.append("handled")

    events = Events("request_start")

    events.request_start += handler
    events.request_start += handler

    assert len(events.request_start) == 2
    assert list(events.request_start) == [handler, handler]

    events.request_start -= handler

    assert len(events.request_start) == 0
    events.request_start()
    assert calls == []

    with pytest.raises(AttributeError):
        _ = events._private  # type: ignore[attr-defined]

    assert EventsException is EventsError
