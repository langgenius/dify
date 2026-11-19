import pytest

from events import Events, EventsError, EventsException


def test_events_package_exposes_opensearchpy_compatible_events_class() -> None:
    calls: list[str] = []
    events = Events()

    # Augmented assignment writes the slot back onto the instance, so pyrefly cannot
    # resolve it through `__getattr__`; plain reads below need no ignore.
    events.request_start += lambda: calls.append("start")  # type: ignore[attr-defined]
    events.request_end += lambda: calls.append("end")  # type: ignore[attr-defined]

    events.request_start()
    events.request_end()

    assert calls == ["start", "end"]


def test_events_package_supports_named_slots_iteration_removal_and_private_attrs() -> None:
    calls: list[str] = []

    def handler() -> None:
        calls.append("handled")

    events = Events("request_start")

    events.request_start += handler  # type: ignore[attr-defined]
    events.request_start += handler  # type: ignore[attr-defined]

    assert len(events.request_start) == 2
    assert list(events.request_start) == [handler, handler]

    events.request_start -= handler  # type: ignore[attr-defined]

    assert len(events.request_start) == 0
    events.request_start()
    assert calls == []

    with pytest.raises(AttributeError):
        _ = events._private

    assert EventsException is EventsError
